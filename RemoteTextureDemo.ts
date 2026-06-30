import { Color } from "./Yuu API/Basic Types/Color";
import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { inWorldConsole } from "./Yuu API/Console";
import { registerStart } from "./Yuu API/RegisterStart";
import { applyRemoteTexture, fetchManifest } from "./Yuu API/RemoteTexture";
import { spawnPrimitive } from "./Yuu API/SpawnPrimitive";


/**
 * RemoteTexture demo
 * ==================
 * Spawns a cube and applies a server-converted texture to it.
 *
 * Point TEXTURE_HOST at your running conversion server (see TextureServer/), then make
 * sure a texture with id `brick_01` exists (drop an image in TextureServer/sources/).
 * If the server is unreachable the cube still spawns; the failure is logged, not fatal.
 */

const TEXTURE_HOST = '127.0.0.1:8080'; // host[:port] of the conversion server
const TEXTURE_PATH = '/tex/brick_01.json'; // .json -> json tier; use /tex/<id>.zip for the zip tier


registerStart(start);

function start() {
  inWorldConsole.visible(true, new Vector3(0, 2, -2));

  // A plain white cube in front of the player; the texture replaces its surface.
  const cube = spawnPrimitive.cube(
    new Vector3(0, 1.5, -1.5),
    new Vector3(0.5, 0.5, 0.5),
    Quaternion.one,
    new Color(1, 1, 1),
    1,
    true,
    'Static',
    undefined,
  );

  // Optional: list what the server has.
  const manifest = fetchManifest(TEXTURE_HOST);
  console.log('RemoteTexture: server has ' + manifest.length + ' texture(s).');

  applyRemoteTexture(cube, TEXTURE_HOST, TEXTURE_PATH, { useMipMaps: true })
    .then(() => { console.log('RemoteTexture: applied ' + TEXTURE_PATH); })
    .catch((e) => { console.log('RemoteTexture: ' + e); });
}
