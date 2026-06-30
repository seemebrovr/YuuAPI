import { Color } from "./Basic Types/Color";
import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { grabbable, Hand } from "./Grabbable";
import { Player } from "./Player";
import { Raycast } from "./Raycast";
import { registerStart } from "./RegisterStart";
import { spawnPrimitive } from "./SpawnPrimitive";


// ============================================================================
// PropertyPanel - a tall, card-based, tabbed property inspector for an entity.
// ----------------------------------------------------------------------------
//  - Grab the HEADER bar (object name) with the trigger to drag the panel.
//  - A curved line connects the panel to the object it edits.
//  - Tabs: Behavior / Attributes / Gameplay / Physics. Each tab shows a section
//    header (with a Reset button) and a column of "setting cards", each with a
//    title, a short description and a control on the right.
//  - Attributes shows LIVE Position / Rotation / Scale as the object moves.
//
// Built from flat 3D planes, so gradients / rounded corners / soft shadows from
// the web mockup are approximated with solid colors. Reusable builders mirror
// the mockup's components: settingRow, toggleSwitch, dropdownButton,
// segmentedControl, sectionHeader, primaryButton, etc.
// ============================================================================


type TabName = 'Behavior' | 'Attributes' | 'Gameplay' | 'Physics';
type CollideWith = 'Both' | 'Objects' | 'Players' | 'None';
type Motion = 'None' | 'Animated' | 'Interactive';
type Interaction = 'Grabbable' | 'Physics' | 'Physics and Grabbable';

type OpenOptions = {
  name?: string,
  onDuplicate?: (target: Entity) => void,
};

type Settings = {
  reflectShadow: boolean,
  childrenOverride: boolean,
  collideWith: CollideWith,
  motion: Motion,
  interaction: Interaction,
  gravity: boolean,
  tintColor: Color,
  tintAlpha: number,
};

type Btn = { root: Entity, label: Entity };


// --- per-entity persisted state --------------------------------------------

const physicsEnabled = new Map<Entity, boolean>();
const frozen = new Map<Entity, { pos: Vector3, rot: Quaternion }>();
const settingsMap = new Map<Entity, Settings>();

function defaultSettings(): Settings {
  return {
    reflectShadow: true,
    childrenOverride: false,
    collideWith: 'Both',
    motion: 'Interactive',
    interaction: 'Grabbable',
    gravity: true,
    tintColor: new Color(1, 1, 1),
    tintAlpha: 1,
  };
}

function getSettings(entity: Entity): Settings {
  let s = settingsMap.get(entity);
  if (!s) { s = defaultSettings(); settingsMap.set(entity, s); }
  return s;
}


export const propertyPanel = {
  open,
  close,
  isOpen,
  getPhysicsEnabled,
  setPhysicsEnabled,
  setFrozenPose,
};


// --- theme (from the supplied mockup) ---------------------------------------

const panelBg = new Color(0.090, 0.106, 0.141);   // #171B24
const headerBg = new Color(0.045, 0.055, 0.075);  // dark header band
const tabIdle = new Color(0.149, 0.173, 0.220);   // #262C38
const accent = new Color(0.486, 0.361, 1.0);      // #7C5CFF
const accentHi = new Color(0.655, 0.545, 0.980);  // #A78BFA
const resetBg = new Color(0.165, 0.188, 0.239);   // #2A303D
const cardBg = new Color(0.145, 0.169, 0.212);    // #252B36
const cardBg2 = new Color(0.169, 0.196, 0.251);   // #2B3140
const segBg = new Color(0.192, 0.220, 0.290);     // #31384A
const descColor = new Color(0.722, 0.753, 0.800); // #B8C0CC
const disabledText = new Color(0.478, 0.498, 0.549); // #7A7F8C
const blueBtn = new Color(0.176, 0.612, 0.859);   // #2D9CDB
const lineColor = new Color(0.02, 0.02, 0.02);

const W = 0.7;
const H = 1.16;
const SEG = 14;

const cardW = W - 0.06;        // setting-card width
const cardHalf = cardW / 2;
const leftPad = -cardHalf + 0.02;
const rowH = 0.088;
const EW = 0.0065;             // approx text width per (char * fontSize), for left-align

// Row centre Y positions (8 rows fit on the tall panel).
const rowY = [0.313, 0.213, 0.113, 0.013, -0.087, -0.187, -0.287, -0.387];
const sectionY = 0.394;


// --- live panel state -------------------------------------------------------

let panelRoot: Entity | undefined;
let contentRoot: Entity | undefined;
let titleHandle: Entity | undefined;
let target: Entity | undefined;
let openOptions: OpenOptions = {};
let activeTab: TabName = 'Behavior';
let tabHandles: { name: TabName, root: Entity }[] = [];
let connector: Entity[] = [];
let liveAttr: { pos: Entity[], rot: Entity[], scale: Entity[] } | undefined;
let drag: { hand: Hand, offset: Vector3 } | undefined;


function isOpen(): boolean { return panelRoot !== undefined; }

function getPhysicsEnabled(entity: Entity): boolean { return physicsEnabled.get(entity) ?? true; }

function setPhysicsEnabled(entity: Entity, enabled: boolean): void {
  physicsEnabled.set(entity, enabled);
  frozen.delete(entity);
}

function setFrozenPose(entity: Entity, pos: Vector3, rot: Quaternion): void {
  frozen.set(entity, { pos: pos.clone(), rot: rot.clone() });
}


function facePlayer(pos: Vector3): Quaternion {
  const head = Player.head.position.get();
  if (!head) { return Quaternion.one; }
  const dx = head.x - pos.x;
  const dz = head.z - pos.z;
  const len = Math.sqrt((dx * dx) + (dz * dz));
  if (len < 0.0001) { return Quaternion.one; }
  return Quaternion.fromEuler(new Vector3(0, Math.atan2(dx / len, dz / len), 0));
}


function open(t: Entity, options: OpenOptions = {}): void {
  close();

  target = t;
  openOptions = options;
  activeTab = 'Behavior';

  const current = t.mesh.color.get();
  if (current) {
    const s = getSettings(t);
    s.tintColor = current.color;
    s.tintAlpha = current.alpha;
  }

  const anchor = t.pos.add(new Vector3(0.45, 0.75, 0));
  const facing = facePlayer(anchor);

  panelRoot = spawnPrimitive.plane('Front', anchor, new Vector3(W, H, 1), facing, panelBg, 1, 'None', 'Static', undefined);

  buildChrome(t);
  buildContent(t);
  buildConnector();
}

function close(): void {
  if (panelRoot) { panelRoot.destroy(); }
  connector.forEach((seg) => { if (seg.exists()) { seg.destroy(); } });

  panelRoot = undefined;
  contentRoot = undefined;
  titleHandle = undefined;
  target = undefined;
  tabHandles = [];
  connector = [];
  liveAttr = undefined;
  drag = undefined;
}


// --- persistent chrome: header, tabs, footer, bottom button -----------------

function buildChrome(t: Entity): void {
  const root = panelRoot!;

  // Header band is the drag handle.
  titleHandle = rect(root, new Vector3(0, 0.5425, 0.0016), new Vector3(W - 0.012, 0.075, 1), headerBg, true);
  rect(root, new Vector3(leftPad + 0.01, 0.5425, 0.004), new Vector3(0.026, 0.026, 1), accent, false); // drag-handle dot
  leftText(root, leftPad + 0.04, 0.5425, openOptions.name ?? 'Object', 4, Color.white);

  // Header tool buttons.
  const snap = button(root, new Vector3(0.07, 0.5425, 0.004), new Vector3(0.07, 0.046, 1), 'Snap', 2, grabbable.getSnapEnabled(t) ? accent : tabIdle, Color.white);
  snap.root.rayClick.setClickFunction(() => {
    grabbable.setSnapEnabled(t, !grabbable.getSnapEnabled(t));
    snap.root.mesh.color.set(grabbable.getSnapEnabled(t) ? accent : tabIdle, 1);
  });
  const dup = button(root, new Vector3(0.15, 0.5425, 0.004), new Vector3(0.07, 0.046, 1), 'Dup', 2, tabIdle, Color.white);
  if (openOptions.onDuplicate) {
    const onDuplicate = openOptions.onDuplicate;
    dup.root.rayClick.setClickFunction(() => onDuplicate(t));
  }
  const reset = button(root, new Vector3(0.23, 0.5425, 0.004), new Vector3(0.07, 0.046, 1), 'Rot0', 2, tabIdle, Color.white);
  reset.root.rayClick.setClickFunction(() => { t.rot = Quaternion.one; });

  const closeBtn = button(root, new Vector3(0.315, 0.5425, 0.004), new Vector3(0.045, 0.046, 1), 'X', 4, accent, Color.white);
  closeBtn.root.rayClick.setClickFunction(() => close());

  // Tab row (4 even columns).
  const names: TabName[] = ['Behavior', 'Attributes', 'Gameplay', 'Physics'];
  const tabW = (cardW - 3 * 0.006) / 4;
  const pitch = tabW + 0.006;
  const start = -cardHalf + tabW / 2;
  tabHandles = [];
  names.forEach((n, i) => {
    const tab = button(root, new Vector3(start + i * pitch, 0.463, 0.004), new Vector3(tabW, 0.06, 1), n, 2, n === activeTab ? accent : tabIdle, Color.white);
    tab.root.rayClick.setClickFunction(() => setTab(n));
    tabHandles.push({ name: n, root: tab.root });
  });

  // Attached-script bar.
  rect(root, new Vector3(0, -0.476, 0.0016), new Vector3(cardW, 0.062, 1), cardBg, false);
  leftText(root, leftPad, -0.476, 'ATTACHED SCRIPT', 2, accentHi);
  label(root, new Vector3(cardHalf - 0.03, -0.476, 0.004), 'v', 3, descColor);

  // Bottom primary button.
  const obj = button(root, new Vector3(0, -0.543, 0.004), new Vector3(cardW, 0.05, 1), openOptions.name ?? 'Object', 3, blueBtn, Color.white);
  void obj; // placeholder action for now
}

function setTab(tab: TabName): void {
  if (!panelRoot || !target) { return; }
  activeTab = tab;
  tabHandles.forEach((h) => h.root.mesh.color.set(h.name === tab ? accent : tabIdle, 1));
  liveAttr = undefined;
  if (contentRoot) { contentRoot.destroy(); contentRoot = undefined; }
  buildContent(target);
}

function buildContent(t: Entity): void {
  contentRoot = new Entity(new Vector3(0, 0, 0.005), Quaternion.one, Vector3.one, panelRoot!, 'Static');

  sectionHeader(contentRoot, activeTab.toUpperCase(), () => resetTab(t));

  if (activeTab === 'Behavior') { buildBehavior(t); }
  else if (activeTab === 'Attributes') { buildAttributes(t); }
  else if (activeTab === 'Gameplay') { buildGameplay(t); }
  else { buildPhysics(); }
}

function resetTab(t: Entity): void {
  const s = getSettings(t);
  if (activeTab === 'Behavior') {
    t.visible.set(true);
    grabbable.setCollidable(t, true);
    s.reflectShadow = true; s.childrenOverride = false; s.collideWith = 'Both';
    s.motion = 'Interactive'; s.interaction = 'Grabbable'; s.gravity = true;
    applyMotion(t);
  } else if (activeTab === 'Attributes') {
    s.tintColor = new Color(1, 1, 1); s.tintAlpha = 1;
    t.mesh.color.set(s.tintColor, s.tintAlpha);
  } else if (activeTab === 'Gameplay') {
    t.tags.clear();
  }
  setTab(activeTab);
}


// --- Behavior tab -----------------------------------------------------------

function buildBehavior(t: Entity): void {
  const c = contentRoot!;

  const r0 = settingRow(c, rowY[0], 'Visible', 'Shown in the world.', false);
  toggleSwitch(r0, () => t.visible.get() ?? true, () => t.visible.set(!(t.visible.get() ?? true)), true);

  const r1 = settingRow(c, rowY[1], 'Reflect & Shadow', 'Reflections & shadows.', false);
  toggleSwitch(r1, () => getSettings(t).reflectShadow, () => { getSettings(t).reflectShadow = !getSettings(t).reflectShadow; }, true);

  const r2 = settingRow(c, rowY[2], 'Collidable', 'Collides with objects.', false);
  toggleSwitch(r2, () => grabbable.getCollidable(t), () => grabbable.setCollidable(t, !grabbable.getCollidable(t)), true);

  const r3 = settingRow(c, rowY[3], 'Children Override', 'Override children.', true);
  toggleSwitch(r3, () => getSettings(t).childrenOverride, () => { }, false);

  const r4 = settingRow(c, rowY[4], 'Collide With', 'What it collides with.', false);
  dropdownButton(r4, () => getSettings(t).collideWith, () => { const s = getSettings(t); s.collideWith = nextCollide(s.collideWith); });

  const r5 = settingRow(c, rowY[5], 'Motion', 'How it moves.', false);
  segmentedControl(r5, ['None', 'Anim', 'Intr'], () => motionIndex(t), (i) => {
    getSettings(t).motion = (['None', 'Animated', 'Interactive'] as Motion[])[i];
    applyMotion(t);
  });

  const r6 = settingRow(c, rowY[6], 'Interaction', 'How you grab it.', false);
  segmentedControl(r6, ['Grab', 'Phys', 'Both'], () => interactionIndex(t), (i) => {
    getSettings(t).interaction = (['Grabbable', 'Physics', 'Physics and Grabbable'] as Interaction[])[i];
    applyInteraction(t);
  });

  const r7 = settingRow(c, rowY[7], 'Gravity', 'Apply gravity.', false);
  toggleSwitch(r7, () => getSettings(t).gravity, () => { getSettings(t).gravity = !getSettings(t).gravity; }, true);
}

function motionIndex(t: Entity): number { const m = getSettings(t).motion; return m === 'None' ? 0 : (m === 'Animated' ? 1 : 2); }
function interactionIndex(t: Entity): number { const x = getSettings(t).interaction; return x === 'Grabbable' ? 0 : (x === 'Physics' ? 1 : 2); }

function nextCollide(c: CollideWith): CollideWith {
  const order: CollideWith[] = ['Both', 'Objects', 'Players', 'None'];
  return order[(order.indexOf(c) + 1) % order.length];
}

function applyMotion(t: Entity): void {
  const s = getSettings(t);
  if (s.motion === 'Interactive') { applyInteraction(t); }
  else if (s.motion === 'None') { setPhysicsEnabled(t, false); }
}

function applyInteraction(t: Entity): void {
  const s = getSettings(t);
  const physics = (s.interaction === 'Physics' || s.interaction === 'Physics and Grabbable');
  setPhysicsEnabled(t, physics);
}


// --- Attributes tab ---------------------------------------------------------

function buildAttributes(t: Entity): void {
  const c = contentRoot!;
  const e = toEulerDegrees(t.rot);

  const r0 = settingRow(c, rowY[0], 'Position', '', false);
  const posLabels = triField(r0, [f2(t.pos.x), f2(t.pos.y), f2(t.pos.z)]);

  const r1 = settingRow(c, rowY[1], 'Rotation', '', false);
  const rotLabels = triField(r1, [f2(e.x), f2(e.y), f2(e.z)]);

  const r2 = settingRow(c, rowY[2], 'Scale', '', false);
  const scaleLabels = triField(r2, [f2(t.scale.x), f2(t.scale.y), f2(t.scale.z)]);

  liveAttr = { pos: posLabels, rot: rotLabels, scale: scaleLabels };

  const r3 = settingRow(c, rowY[3], 'Tint Color', 'Recolor the object.', false);
  const swatches = [
    new Color(0.85, 0.2, 0.2), new Color(0.2, 0.7, 0.3), new Color(0.2, 0.45, 1),
    new Color(0.95, 0.8, 0.2), new Color(0.6, 0.3, 0.85), new Color(0.95, 0.55, 0.15),
    new Color(1, 1, 1), new Color(0.12, 0.12, 0.14),
  ];
  let sx = 0.01;
  swatches.forEach((col) => {
    const sw = rect(r3, new Vector3(sx, 0, 0.002), new Vector3(0.032, 0.032, 1), col, true);
    sw.rayClick.setClickFunction(() => { const s = getSettings(t); s.tintColor = col; t.mesh.color.set(col, s.tintAlpha); });
    sx += 0.038;
  });

  const r4 = settingRow(c, rowY[4], 'Tint Strength', 'Object opacity.', false);
  const s = getSettings(t);
  const minus = button(r4, new Vector3(0.13, 0, 0.002), new Vector3(0.04, 0.05, 1), '-', 4, segBg, Color.white);
  const valLabel = label(r4, new Vector3(0.225, 0, 0.003), s.tintAlpha.toFixed(2), 3, Color.white);
  const plus = button(r4, new Vector3(0.30, 0, 0.002), new Vector3(0.04, 0.05, 1), '+', 4, segBg, Color.white);
  const applyTint = () => { t.mesh.color.set(s.tintColor, s.tintAlpha); valLabel.text.display.set(s.tintAlpha.toFixed(2)); };
  minus.root.rayClick.setClickFunction(() => { s.tintAlpha = Math.max(0.1, Math.round((s.tintAlpha - 0.1) * 10) / 10); applyTint(); });
  plus.root.rayClick.setClickFunction(() => { s.tintAlpha = Math.min(1, Math.round((s.tintAlpha + 0.1) * 10) / 10); applyTint(); });
}

// Three value chips on the right of a card (Position/Rotation/Scale).
function triField(card: Entity, vals: string[]): Entity[] {
  const xs = [0.12, 0.215, 0.31];
  return vals.map((v, i) => chip(card, new Vector3(xs[i], 0, 0.002), new Vector3(0.088, 0.05, 1), v, 2, cardBg2, Color.white).label);
}


// --- Gameplay tab -----------------------------------------------------------

const presetTags = ['Wall', 'Floor', 'Prop', 'Goal', 'Spawn', 'Trigger'];

function tagSummary(t: Entity): string {
  const tags = t.tags.get();
  return (tags.length > 0 ? tags[0] : 'none') + '     ' + tags.length + '/20';
}

function buildGameplay(t: Entity): void {
  const c = contentRoot!;

  const r0 = settingRow(c, rowY[0], 'Gameplay Tag', 'Tag this entity.', false);
  const summary = chip(r0, new Vector3(0.2, 0, 0.002), new Vector3(0.2, 0.05, 1), tagSummary(t), 2, cardBg2, Color.white);

  label(c, new Vector3(0, rowY[1] + 0.02, 0.002), 'Tap a tag to add or remove it', 2, descColor);

  const cols = [-0.18, 0.0, 0.18];
  const rows = [rowY[1] - 0.04, rowY[2] - 0.01];
  presetTags.forEach((tag, i) => {
    const col = cols[i % 3];
    const row = rows[Math.floor(i / 3)];
    const on = t.tags.get().includes(tag);
    const b = button(c, new Vector3(col, row, 0.002), new Vector3(0.16, 0.06, 1), tag, 3, on ? accent : cardBg2, Color.white);
    b.root.rayClick.setClickFunction(() => {
      if (t.tags.get().includes(tag)) { t.tags.remove(tag); } else { t.tags.add(tag); }
      const nowOn = t.tags.get().includes(tag);
      b.root.mesh.color.set(nowOn ? accent : cardBg2, 1);
      summary.label.text.display.set(tagSummary(t));
    });
  });
}


// --- Physics tab (placeholder) ---------------------------------------------

function buildPhysics(): void {
  const c = contentRoot!;
  valueRow(c, rowY[0], 'Mass', 'Body weight.', '1.00');
  valueRow(c, rowY[1], 'Friction', 'Surface grip.', '0.50');
  valueRow(c, rowY[2], 'Bounce', 'Restitution.', '0.00');
  label(c, new Vector3(0, rowY[3], 0.002), '(placeholder - not wired yet)', 2, disabledText);
}

function valueRow(parent: Entity, y: number, title: string, desc: string, val: string): void {
  const card = settingRow(parent, y, title, desc, false);
  chip(card, new Vector3(0.26, 0, 0.002), new Vector3(0.13, 0.05, 1), val, 2, cardBg2, Color.white);
}


// --- reusable UI components -------------------------------------------------

// A setting card: background + left title + optional description. Returns the
// card entity so a control can be parented to its right-hand side.
function settingRow(parent: Entity, cy: number, title: string, desc: string, disabled: boolean): Entity {
  const card = rect(parent, new Vector3(0, cy, 0.001), new Vector3(cardW, rowH, 1), disabled ? panelBg : cardBg, false);
  const titleColor = disabled ? disabledText : Color.white;
  if (desc) {
    leftText(card, leftPad, 0.016, title, 3, titleColor);
    leftText(card, leftPad, -0.02, desc, 2, disabled ? disabledText : descColor);
  } else {
    leftText(card, leftPad, 0, title, 3, titleColor);
  }
  return card;
}

// Section header: purple title, help dot, Reset button.
function sectionHeader(parent: Entity, title: string, onReset: () => void): void {
  leftText(parent, leftPad, sectionY, title, 3, accentHi);
  const hw = title.length * 3 * EW;
  chip(parent, new Vector3(leftPad + hw + 0.03, sectionY, 0.002), new Vector3(0.026, 0.026, 1), '?', 2, resetBg, descColor);
  const reset = button(parent, new Vector3(cardHalf - 0.075, sectionY, 0.002), new Vector3(0.14, 0.05, 1), 'Reset', 2, resetBg, Color.white);
  reset.root.rayClick.setClickFunction(onReset);
}

// Toggle pill (purple = on). Parented to the right of a card.
function toggleSwitch(card: Entity, getOn: () => boolean, onToggle: () => void, enabled: boolean): void {
  const on = getOn();
  const pill = button(card, new Vector3(0.26, 0, 0.002), new Vector3(0.1, 0.05, 1), on ? 'On' : 'Off', 3, enabled ? (on ? accent : cardBg2) : cardBg2, enabled ? Color.white : disabledText);
  if (enabled) {
    pill.root.rayClick.setClickFunction(() => {
      onToggle();
      const nowOn = getOn();
      pill.label.text.display.set(nowOn ? 'On' : 'Off');
      pill.root.mesh.color.set(nowOn ? accent : cardBg2, 1);
    });
  }
}

// Tap-to-cycle dropdown (no popup menu in VR).
function dropdownButton(card: Entity, getValue: () => string, onCycle: () => void): void {
  const pill = button(card, new Vector3(0.23, 0, 0.002), new Vector3(0.19, 0.05, 1), getValue() + '   v', 2, cardBg2, Color.white);
  pill.root.rayClick.setClickFunction(() => { onCycle(); pill.label.text.display.set(getValue() + '   v'); });
}

// 3-up segmented control; selected segment is purple.
function segmentedControl(card: Entity, opts: string[], getIndex: () => number, onSelect: (i: number) => void): void {
  const xs = [0.12, 0.215, 0.31];
  const roots: Entity[] = [];
  const retint = () => { const idx = getIndex(); roots.forEach((r, i) => r.mesh.color.set(i === idx ? accent : segBg, 1)); };
  opts.forEach((o, i) => {
    const b = button(card, new Vector3(xs[i], 0, 0.002), new Vector3(0.088, 0.05, 1), o, 2, segBg, Color.white);
    roots.push(b.root);
    b.root.rayClick.setClickFunction(() => { onSelect(i); retint(); });
  });
  retint();
}


// --- primitive helpers ------------------------------------------------------

function rect(parent: Entity, pos: Vector3, scale: Vector3, color: Color, interactive: boolean): Entity {
  const e = spawnPrimitive.plane('Front', pos, scale, Quaternion.one, color, 1, interactive ? 'Concave' : 'None', 'Static', parent);
  if (interactive) { e.rayClick.initialize(false); }
  return e;
}

function label(parent: Entity, pos: Vector3, text: string, fontSize: number, color: Color): Entity {
  const e = new Entity(pos, Quaternion.one, Vector3.one, parent, 'Static');
  e.text.create(text, fontSize, 0);
  e.text.doubleSided.set(false);
  e.text.color.set(color);
  return e;
}

// Left-anchored text: estimate the width and offset the (centre-anchored) label
// so its left edge sits at leftX. Keeps long labels from clipping the panel.
function leftText(parent: Entity, leftX: number, y: number, text: string, fontSize: number, color: Color): Entity {
  const w = text.length * fontSize * EW;
  return label(parent, new Vector3(leftX + (w / 2), y, 0.003), text, fontSize, color);
}

function button(parent: Entity, pos: Vector3, scale: Vector3, text: string, fontSize: number, bg: Color, fg: Color): Btn {
  const root = rect(parent, pos.add(new Vector3(0, 0, 0.0006)), scale, bg, true);
  const lab = label(root, new Vector3(0, 0, 0.001), text, fontSize, fg);
  return { root, label: lab };
}

function chip(parent: Entity, pos: Vector3, scale: Vector3, text: string, fontSize: number, bg: Color, fg: Color): Btn {
  const root = rect(parent, pos.add(new Vector3(0, 0, 0.0006)), scale, bg, false);
  const lab = label(root, new Vector3(0, 0, 0.001), text, fontSize, fg);
  return { root, label: lab };
}

function f2(n: number): string { return (Math.round(n * 100) / 100).toFixed(2); }

// Quaternion -> Euler degrees (engine ZYX convention, matches fromEuler).
function toEulerDegrees(q: Quaternion): Vector3 {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;

  const m11 = 1 - 2 * (yy + zz);
  const m21 = 2 * (xy + wz);
  const m31 = 2 * (xz - wy);
  const m32 = 2 * (yz + wx);
  const m33 = 1 - 2 * (xx + yy);
  const m12 = 2 * (xy - wz);
  const m22 = 1 - 2 * (xx + zz);

  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  let ex: number, ey: number, ez: number;
  ey = Math.asin(-clamp(m31));
  if (Math.abs(m31) < 0.9999999) {
    ex = Math.atan2(m32, m33);
    ez = Math.atan2(m21, m11);
  } else {
    ex = 0;
    ez = Math.atan2(-m12, m22);
  }

  const k = 180 / Math.PI;
  const norm = (d: number) => { let r = d % 360; if (r < 0) { r += 360; } return r; };
  return new Vector3(norm(ex * k), norm(ey * k), norm(ez * k));
}


// --- connector line ---------------------------------------------------------

function buildConnector(): void {
  connector = [];
  for (let i = 0; i < SEG; i++) {
    const seg = spawnPrimitive.cube(Vector3.zero, new Vector3(0.006, 0.006, 0.05), Quaternion.one, lineColor, 1, false, 'Empty', undefined);
    connector.push(seg);
  }
  updateConnector();
}

function bezier(a: Vector3, c: Vector3, b: Vector3, t: number): Vector3 {
  const u = 1 - t;
  const w0 = u * u, w1 = 2 * u * t, w2 = t * t;
  return new Vector3(
    (a.x * w0) + (c.x * w1) + (b.x * w2),
    (a.y * w0) + (c.y * w1) + (b.y * w2),
    (a.z * w0) + (c.z * w1) + (b.z * w2),
  );
}

function lookRotation(dir: Vector3): Quaternion {
  const len = dir.magnitude();
  if (len < 1e-6) { return Quaternion.one; }
  const d = dir.divide(len);
  const yaw = Math.atan2(d.x, d.z);
  const pitch = -Math.asin(Math.max(-1, Math.min(1, d.y)));
  return Quaternion.fromEuler(new Vector3(pitch, yaw, 0));
}

function updateConnector(): void {
  if (!panelRoot || !target || connector.length === 0) { return; }

  const a = target.pos;
  const b = panelRoot.pos.add(panelRoot.rot.rotateVector(new Vector3(0, -H / 2, 0)));
  const control = a.add(b).multiply(0.5).add(new Vector3(0, -0.18, 0));

  for (let i = 0; i < SEG; i++) {
    const p0 = bezier(a, control, b, i / SEG);
    const p1 = bezier(a, control, b, (i + 1) / SEG);
    const dir = p1.subtract(p0);
    const len = dir.magnitude();

    const seg = connector[i];
    seg.pos = p0.add(p1).multiply(0.5);
    seg.scale = new Vector3(0.006, 0.006, Math.max(0.001, len));
    seg.rot = lookRotation(dir);
  }
}


// --- header drag ------------------------------------------------------------

function handState(hand: Hand): { pos: Vector3 | undefined, fwd: Vector3 | undefined } {
  if (hand === 'Left') { return { pos: Player.leftHand.position.get(), fwd: Player.leftHand.forward.get() }; }
  return { pos: Player.rightHand.position.get(), fwd: Player.rightHand.forward.get() };
}

function onTriggerPressed(hand: Hand): void {
  if (!panelRoot || !titleHandle || drag) { return; }
  const h = handState(hand);
  if (!h.pos || !h.fwd) { return; }

  const hit = Raycast.directional(h.pos, h.fwd, 6, { getEntity: true });
  if (hit && hit.entity === titleHandle) {
    drag = { hand, offset: panelRoot.pos.subtract(h.pos) };
  }
}

function onTriggerReleased(hand: Hand): void {
  if (drag && drag.hand === hand) { drag = undefined; }
}


// --- update loop ------------------------------------------------------------

registerStart(start);
function start() {
  Events.onPhysicsUpdate(onPhysicsUpdate);
  Controller.subscribe('leftTrigger', 'Pressed', () => onTriggerPressed('Left'));
  Controller.subscribe('rightTrigger', 'Pressed', () => onTriggerPressed('Right'));
  Controller.subscribe('leftTrigger', 'Released', () => onTriggerReleased('Left'));
  Controller.subscribe('rightTrigger', 'Released', () => onTriggerReleased('Right'));
}

function onPhysicsUpdate(deltaTime: number) {
  physicsEnabled.forEach((enabled, entity) => {
    if (enabled || !entity.exists()) { return; }
    if (grabbable.isHeld(entity)) { frozen.delete(entity); return; }

    let pin = frozen.get(entity);
    if (!pin) {
      pin = { pos: entity.pos.clone(), rot: entity.rot.clone() };
      frozen.set(entity, pin);
    }
    entity.pos = pin.pos;
    entity.rot = pin.rot;
    entity.velocity.set(Vector3.zero);
  });

  if (drag && panelRoot) {
    const h = handState(drag.hand);
    if (h.pos) { panelRoot.pos = h.pos.add(drag.offset); }
  }

  if (liveAttr && target && target.exists()) {
    const p = target.pos, sc = target.scale, e = toEulerDegrees(target.rot);
    liveAttr.pos[0].text.display.set(f2(p.x)); liveAttr.pos[1].text.display.set(f2(p.y)); liveAttr.pos[2].text.display.set(f2(p.z));
    liveAttr.rot[0].text.display.set(f2(e.x)); liveAttr.rot[1].text.display.set(f2(e.y)); liveAttr.rot[2].text.display.set(f2(e.z));
    liveAttr.scale[0].text.display.set(f2(sc.x)); liveAttr.scale[1].text.display.set(f2(sc.y)); liveAttr.scale[2].text.display.set(f2(sc.z));
  }

  updateConnector();
}
