import { Color } from "./Basic Types/Color";
import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { grabbable, Hand } from "./Grabbable";
import { Player } from "./Player";
import { propertyPanel } from "./PropertyPanel";
import { registerStart } from "./RegisterStart";
import { spawnPrimitive } from "./SpawnPrimitive";


// Per-axis, one-sided resize handles. Select an object (ray + trigger), then drag
// a face handle. By default the GRIP starts a drag; in edit mode the grip is for
// flying, so the project switches to the trigger via startDrag()/stopDrag() and
// setGripEnabled(false).


type Handle = { entity: Entity, localDir: Vector3, axisIndex: number }
type GizmoOptions = { onScale?: (scale: Vector3) => void }
type GizmoState = { target: Entity, handles: Handle[], options: GizmoOptions, selected: boolean }

const gizmos: GizmoState[] = [];
const handleSize = 0.05;
const handleGap = 0.12;
const handleGrabRadius = 0.08;
const minSize = 0.05;

let gripEnabled = true;

type Drag = { gizmo: GizmoState, hand: Hand, axisIndex: number, axisDir: Vector3, anchor: Vector3, grabOffset: number, startScale: Vector3, rot: Quaternion }
let drag: Drag | undefined;


export const scaleGizmo = {
  attach,
  isDragging: () => drag !== undefined,
  startDrag: tryStartDrag,
  stopDrag,
  setGripEnabled: (enabled: boolean) => { gripEnabled = enabled; },
};


function attach(target: Entity, options: GizmoOptions = {}): void {
  const handles: Handle[] = [
    { entity: makeHandle(new Color(0.9, 0.15, 0.15)), localDir: new Vector3(1, 0, 0), axisIndex: 0 },
    { entity: makeHandle(new Color(0.45, 0.08, 0.08)), localDir: new Vector3(-1, 0, 0), axisIndex: 0 },
    { entity: makeHandle(new Color(0.2, 0.8, 0.2)), localDir: new Vector3(0, 1, 0), axisIndex: 1 },
    { entity: makeHandle(new Color(0.08, 0.4, 0.08)), localDir: new Vector3(0, -1, 0), axisIndex: 1 },
    { entity: makeHandle(new Color(0.25, 0.5, 1)), localDir: new Vector3(0, 0, 1), axisIndex: 2 },
    { entity: makeHandle(new Color(0.1, 0.2, 0.55)), localDir: new Vector3(0, 0, -1), axisIndex: 2 },
  ];
  const gizmo: GizmoState = { target, handles, options, selected: false };
  gizmos.push(gizmo);
  target.rayClick.initialize(false);
  target.rayClick.setClickFunction(() => { gizmo.selected = !gizmo.selected; });
}

function makeHandle(color: Color): Entity {
  const handle = spawnPrimitive.cube(new Vector3(0, -100, 0), new Vector3(handleSize, handleSize, handleSize), Quaternion.one, color, 1, false, 'Empty', undefined);
  handle.visible.set(false);
  return handle;
}

function axisComponent(v: Vector3, i: number): number { return i === 0 ? v.x : (i === 1 ? v.y : v.z); }
function withAxis(v: Vector3, i: number, value: number): Vector3 { return new Vector3(i === 0 ? value : v.x, i === 1 ? value : v.y, i === 2 ? value : v.z); }
function setHandlesVisible(gizmo: GizmoState, visible: boolean): void { gizmo.handles.forEach((h) => h.entity.visible.set(visible)); }
function updateHandles(gizmo: GizmoState): void {
  const center = gizmo.target.pos;
  const rot = gizmo.target.rot;
  const scale = gizmo.target.scale;
  gizmo.handles.forEach((h) => { const wd = rot.rotateVector(h.localDir); const half = axisComponent(scale, h.axisIndex) / 2; h.entity.pos = center.add(wd.multiply(half + handleGap)); h.entity.rot = rot; });
}
function handPos(hand: Hand): Vector3 | undefined { return hand === 'Left' ? Player.leftHand.position.get() : Player.rightHand.position.get(); }
function nearestHandle(gizmo: GizmoState, pos: Vector3): Handle | undefined { let nearest: Handle | undefined; let nd = handleGrabRadius; gizmo.handles.forEach((h) => { const d = h.entity.pos.distanceTo(pos); if (d <= nd) { nearest = h; nd = d; } }); return nearest; }

function tryStartDrag(hand: Hand): void {
  if (drag) { return; }
  const pos = handPos(hand);
  if (!pos) { return; }
  for (const gizmo of gizmos) {
    if (!gizmo.selected || !gizmo.target.exists() || grabbable.isHeld(gizmo.target)) { continue; }
    const handle = nearestHandle(gizmo, pos);
    if (!handle) { continue; }
    const rot = gizmo.target.rot;
    const center = gizmo.target.pos;
    const scale = gizmo.target.scale;
    const axisDir = rot.rotateVector(handle.localDir);
    const sizeAxis = axisComponent(scale, handle.axisIndex);
    const anchor = center.subtract(axisDir.multiply(sizeAxis / 2));
    const grabOffset = pos.subtract(anchor).dot(axisDir) - sizeAxis;
    drag = { gizmo, hand, axisIndex: handle.axisIndex, axisDir, anchor, grabOffset, startScale: scale, rot };
    return;
  }
}

function stopDrag(hand: Hand): void { if (drag && drag.hand === hand) { drag = undefined; } }

registerStart(start);
function start() {
  Events.onPhysicsUpdate(onPhysicsUpdate);
  Controller.subscribe('leftGrip', 'Pressed', () => { if (gripEnabled) { tryStartDrag('Left'); } });
  Controller.subscribe('leftGrip', 'Released', () => { if (gripEnabled) { stopDrag('Left'); } });
  Controller.subscribe('rightGrip', 'Pressed', () => { if (gripEnabled) { tryStartDrag('Right'); } });
  Controller.subscribe('rightGrip', 'Released', () => { if (gripEnabled) { stopDrag('Right'); } });
}

function onPhysicsUpdate(deltaTime: number) {
  gizmos.forEach((gizmo) => { const show = gizmo.selected && gizmo.target.exists(); setHandlesVisible(gizmo, show); if (show) { updateHandles(gizmo); } });
  if (drag) {
    const target = drag.gizmo.target;
    if (!target.exists() || !drag.gizmo.selected) { drag = undefined; return; }
    const pos = handPos(drag.hand);
    if (!pos) { return; }
    const projection = pos.subtract(drag.anchor).dot(drag.axisDir);
    let newSizeAxis = projection - drag.grabOffset;
    newSizeAxis = Math.max(minSize, newSizeAxis);
    const newScale = withAxis(drag.startScale, drag.axisIndex, newSizeAxis);
    const newCenter = drag.anchor.add(drag.axisDir.multiply(newSizeAxis / 2));
    target.scale = newScale;
    target.pos = newCenter;
    target.rot = drag.rot;
    target.velocity.set(Vector3.zero);
    propertyPanel.setFrozenPose(target, newCenter, drag.rot);
    drag.gizmo.options.onScale?.(newScale);
  }
}
