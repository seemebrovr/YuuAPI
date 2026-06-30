import { Color } from "./Basic Types/Color";
import { Vector2 } from "./Basic Types/Vector2";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { DirectoryBasePaths, Files } from "./Files";
import { http } from "./Networking/http";
import { Texture } from "./Texture";


/**
 * RemoteTexture
 * =============
 * Fetch a server-converted image and apply it to an object's mesh.
 *
 * Implements the client half of TEXTURE_UPLOAD_CONTRACT.md (Yuu Texture Payload v1).
 *
 * WHY IT IS BUILT THIS WAY (engine constraints)
 *  - The engine has NO image-file decoder and Files can only read TEXT, so the server
 *    decodes/quantizes the image and ships a palette + 1-byte-per-pixel index buffer
 *    (base64; raw or RLE). We rebuild it here with Texture.setPixelsColor.
 *  - setPixelsColor writes one COLOR at a time, so we bucket pixels by palette index
 *    and do at most `paletteCount` (<=256) batched writes - cost is bounded by palette
 *    size, not resolution.
 *  - Heavy mid-frame work hitches/crashes this engine, so the rebuild is spread across
 *    frames (a budget of palette buckets per Events.onUpdate) and the texture is pushed
 *    to the GPU with a single updateTexture() at the end.
 *  - There is no base64 in this VM, so a small decoder is bundled below.
 */


// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export type TextureTier = 'auto' | 'json' | 'zip';

export interface RemoteTexOptions {
  /** Which transport to use. 'auto' picks by URL extension (.zip -> zip, else json). */
  tier?: TextureTier;
  /** Generate mip maps after rebuild (smoother at distance). Default true. */
  useMipMaps?: boolean;
  /** How many palette buckets to write per frame while rebuilding. Default 16. */
  rebuildBudgetPerFrame?: number;
  /** Override the payload's flipY (row origin). Default: use the payload's value. */
  flipY?: boolean;
}

/** One entry of the server manifest (GET /textures.json). */
export interface TextureManifestEntry {
  id: string;
  name: string;
  w: number;
  h: number;
  paletteCount: number;
  tier: 'json' | 'zip';
  path: string;
  bytes: number;
  hash: string;
  thumb?: string;
}

/** The Yuu Texture Payload (YTP) v1 wire object. */
interface YuuTexturePayload {
  v: number;
  w: number;
  h: number;
  colorSpace?: string;
  flipY?: boolean;
  paletteCount: number;
  palette: number[][];
  encoding: 'raw' | 'rle';
  pixels: string;
  hash?: string;
  name?: string;
  error?: string;
  message?: string;
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const RemoteTexture = {
  /** Fetch the server manifest of available textures. */
  fetchManifest,
  /** Fetch + rebuild a Texture from a server URL (does NOT apply it to anything). */
  loadTextureFromURL,
  /** Fetch + rebuild + apply a Texture to an entity's mesh. */
  applyRemoteTexture,
  /** Destroy every cached Texture (e.g. on world unload). */
  clearTextureCache,
};

// Convenience named exports.
export { fetchManifest, loadTextureFromURL, applyRemoteTexture, clearTextureCache };


// Where downloaded zips are staged + extracted (Open Decision O-4).
const CACHE_BASE: DirectoryBasePaths = 'user://profile';
const CACHE_SUB = 'texcache';

// Max dimensions we accept from a payload (mirror of the server ceiling).
const MAX_EDGE = 1024;


// ---------------------------------------------------------------------------
// Texture cache (keyed by server-provided content hash) + ref counting.
// Identical images are rebuilt once and shared; destroyed when the last user drops them.
// ---------------------------------------------------------------------------
interface CacheEntry { tex: Texture; refs: number; }
const cache = new Map<string, CacheEntry>();

// Remembers which hash is currently applied to each entity, so a replacement can
// release the previous texture.
const appliedHash = new Map<Entity, string>();


function clearTextureCache() {
  cache.forEach((entry) => entry.tex.destroy());
  cache.clear();
  appliedHash.clear();
}


// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
function fetchManifest(host: string, path: string = '/textures.json'): TextureManifestEntry[] {
  const data = http.getJson<TextureManifestEntry[]>(host, path);
  return Array.isArray(data) ? data : [];
}


// ---------------------------------------------------------------------------
// Load (fetch + rebuild). Returns a Texture once the (frame-spread) rebuild finishes.
// ---------------------------------------------------------------------------
function loadTextureFromURL(host: string, path: string, opts: RemoteTexOptions = {}): Promise<Texture> {
  const payload = fetchPayload(host, path, opts);

  if (!payload) {
    return Promise.reject(new Error('RemoteTexture: fetch failed for ' + host + path));
  }

  const problem = validatePayload(payload);
  if (problem) {
    return Promise.reject(new Error('RemoteTexture: ' + problem));
  }

  // Cache hit: reuse the already-built texture.
  if (payload.hash) {
    const hit = cache.get(payload.hash);
    if (hit) {
      hit.refs++;
      return Promise.resolve(hit.tex);
    }
  }

  const indices = decodeIndices(payload);
  if (!indices) {
    return Promise.reject(new Error('RemoteTexture: index decode failed'));
  }

  const flipY = opts.flipY !== undefined ? opts.flipY : (payload.flipY === true);
  const buckets = bucketByPalette(payload, indices, flipY);

  const tex = new Texture(payload.w, payload.h);
  const useMipMaps = opts.useMipMaps !== undefined ? opts.useMipMaps : true;
  const budget = Math.max(1, opts.rebuildBudgetPerFrame !== undefined ? opts.rebuildBudgetPerFrame : 16);

  return rebuildAcrossFrames(tex, payload, buckets, budget).then(() => {
    tex.updateTexture();
    if (useMipMaps) { tex.updateMipMaps(); }

    if (payload.hash) {
      cache.set(payload.hash, { tex: tex, refs: 1 });
    }

    return tex;
  });
}


// ---------------------------------------------------------------------------
// Apply to an entity's mesh (releases any previous remote texture on that entity).
// ---------------------------------------------------------------------------
function applyRemoteTexture(entity: Entity, host: string, path: string, opts: RemoteTexOptions = {}): Promise<void> {
  const useMipMaps = opts.useMipMaps !== undefined ? opts.useMipMaps : true;

  return loadTextureFromURL(host, path, opts).then((tex) => {
    entity.mesh.texture.set(tex, useMipMaps);

    // Release the texture this entity had before (ref-count; destroy at zero).
    const prev = appliedHash.get(entity);
    const nextHash = findHashFor(tex);

    if (prev && prev !== nextHash) { release(prev); }
    if (nextHash) { appliedHash.set(entity, nextHash); }
  });
}


function release(hash: string) {
  const entry = cache.get(hash);
  if (!entry) { return; }

  entry.refs--;
  if (entry.refs <= 0) {
    entry.tex.destroy();
    cache.delete(hash);
  }
}


function findHashFor(tex: Texture): string | undefined {
  let found: string | undefined;
  cache.forEach((entry, hash) => { if (entry.tex === tex) { found = hash; } });
  return found;
}


// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
function fetchPayload(host: string, path: string, opts: RemoteTexOptions): YuuTexturePayload | undefined {
  const tier = resolveTier(opts.tier, path);
  return tier === 'zip' ? fetchViaZip(host, path) : http.getJson<YuuTexturePayload>(host, path);
}


function resolveTier(tier: TextureTier | undefined, path: string): 'json' | 'zip' {
  if (tier === 'json' || tier === 'zip') { return tier; }
  return endsWith(path, '.zip') ? 'zip' : 'json'; // 'auto'
}


/** Download a zip, extract it, and read the `texture.json` text inside (Contract 4.4 / 5.1). */
function fetchViaZip(host: string, path: string): YuuTexturePayload | undefined {
  const name = safeName(path);
  const sub = CACHE_SUB + '/' + name;

  const ok = http.downloadZipToFolder(host, path, name, CACHE_BASE, CACHE_SUB);
  if (!ok) { return undefined; }

  const extracted = Files.zip.extractFiles(CACHE_BASE, CACHE_SUB + '/' + name + '.zip', CACHE_BASE, sub);
  if (!extracted) { return undefined; }

  const text = Files.text.get(CACHE_BASE, sub, 'texture', '.json');
  if (!text) { return undefined; }

  try {
    return JSON.parse(text) as YuuTexturePayload;
  }
  catch (e) {
    return undefined;
  }
}


// ---------------------------------------------------------------------------
// Validation (Contract 5.2)
// ---------------------------------------------------------------------------
function validatePayload(p: YuuTexturePayload): string | undefined {
  if (p.error) { return 'server error: ' + p.error + (p.message ? ' (' + p.message + ')' : ''); }
  if (p.v !== 1) { return 'unsupported version v=' + p.v; }
  if (!isInt(p.w) || !isInt(p.h) || p.w < 1 || p.h < 1 || p.w > MAX_EDGE || p.h > MAX_EDGE) {
    return 'bad dimensions ' + p.w + 'x' + p.h;
  }
  if (!Array.isArray(p.palette) || p.palette.length < 1 || p.palette.length > 256) {
    return 'bad palette length';
  }
  if (p.paletteCount !== p.palette.length) { return 'paletteCount != palette.length'; }
  if (p.encoding !== 'raw' && p.encoding !== 'rle') { return 'bad encoding ' + p.encoding; }
  if (typeof p.pixels !== 'string') { return 'pixels not a string'; }
  return undefined;
}


// ---------------------------------------------------------------------------
// Decode: base64 -> index bytes, expanding RLE to exactly w*h indices (Contract 3.5).
// ---------------------------------------------------------------------------
function decodeIndices(p: YuuTexturePayload): Uint8Array | undefined {
  const bytes = decodeBase64(p.pixels);
  const total = p.w * p.h;

  if (p.encoding === 'raw') {
    return bytes.length === total ? bytes : undefined;
  }

  // RLE: triples [count_lo, count_hi, index]; count is u16 little-endian.
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const count = bytes[i] | (bytes[i + 1] << 8);
    const index = bytes[i + 2];
    for (let c = 0; c < count; c++) {
      if (o >= total) { return undefined; } // overflow guard
      out[o++] = index;
    }
  }

  return o === total ? out : undefined;
}


/**
 * Group every pixel coordinate by its palette index. The result is one flat [x,y,x,y,...]
 * array per palette entry; Vector2 objects are only built later (per frame) to keep the
 * decode pass allocation-light.
 */
function bucketByPalette(p: YuuTexturePayload, indices: Uint8Array, flipY: boolean): number[][] {
  const w = p.w;
  const h = p.h;
  const buckets: number[][] = [];
  for (let i = 0; i < p.palette.length; i++) { buckets.push([]); }

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (idx >= buckets.length) { continue; } // defensive: out-of-range index
    const x = i % w;
    const yRaw = (i / w) | 0;
    const y = flipY ? (h - 1 - yRaw) : yRaw;
    const b = buckets[idx];
    b.push(x);
    b.push(y);
  }

  return buckets;
}


// ---------------------------------------------------------------------------
// Rebuild, spread across frames (Contract 5.5). One batched setPixelsColor per color.
// ---------------------------------------------------------------------------
function rebuildAcrossFrames(tex: Texture, p: YuuTexturePayload, buckets: number[][], budget: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let next = 0;

    const subId = Events.onUpdate(() => {
      let processed = 0;

      while (next < buckets.length && processed < budget) {
        const flat = buckets[next];

        if (flat.length > 0) {
          const c = p.palette[next];
          const color = new Color(byteToUnit(c[0]), byteToUnit(c[1]), byteToUnit(c[2]));
          const alpha = byteToUnit(c.length > 3 ? c[3] : 255);

          const coords: Vector2[] = [];
          for (let k = 0; k < flat.length; k += 2) {
            coords.push(new Vector2(flat[k], flat[k + 1]));
          }

          tex.setPixelsColor(coords, color, alpha);
        }

        next++;
        processed++;
      }

      if (next >= buckets.length) {
        Events.unsubscribe(subId);
        resolve();
      }
    });
  });
}


// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function byteToUnit(v: number): number {
  const u = v / 255;
  return u < 0 ? 0 : (u > 1 ? 1 : u);
}

function isInt(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n;
}

function endsWith(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.substring(s.length - suffix.length) === suffix;
}

/** Turn a URL path into a filesystem-safe staging name. */
function safeName(path: string): string {
  let out = '';
  for (let i = 0; i < path.length; i++) {
    const ch = path.charAt(i);
    out += /[A-Za-z0-9_]/.test(ch) ? ch : '_';
  }
  // Trim a trailing "_zip" produced from ".zip" so the staging name is tidy.
  return out.length > 0 ? out : 'tex';
}


// ---------------------------------------------------------------------------
// Base64 -> Uint8Array (no atob in this VM). Standard RFC 4648 alphabet, padding aware.
// ---------------------------------------------------------------------------
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let B64_LOOKUP: Int16Array | undefined;

function buildB64Lookup(): Int16Array {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) { table[i] = -1; }
  for (let i = 0; i < B64_CHARS.length; i++) { table[B64_CHARS.charCodeAt(i)] = i; }
  return table;
}

function decodeBase64(input: string): Uint8Array {
  if (!B64_LOOKUP) { B64_LOOKUP = buildB64Lookup(); }
  const lookup = B64_LOOKUP;

  // Count valid (non-padding) symbols to size the output exactly.
  let validCount = 0;
  for (let i = 0; i < input.length; i++) {
    if (lookup[input.charCodeAt(i) & 0xFF] !== -1) { validCount++; }
  }

  const outLen = (validCount * 3) >> 2; // floor(validCount * 6 / 8)
  const out = new Uint8Array(outLen);

  let acc = 0;
  let bits = 0;
  let o = 0;

  for (let i = 0; i < input.length; i++) {
    const v = lookup[input.charCodeAt(i) & 0xFF];
    if (v === -1) { continue; } // skip '=', newlines, whitespace

    acc = (acc << 6) | v;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xFF;
    }
  }

  return out;
}
