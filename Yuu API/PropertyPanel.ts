import { Color } from "./Basic Types/Color";
import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { grabbable } from "./Grabbable";
import { registerStart } from "./RegisterStart";
import { spawnPrimitive } from "./SpawnPrimitive";


// ============================================================================
// PropertyPanel - a small in-world property panel for an entity.
// ----------------------------------------------------------------------------
// Currently shows one property:
//   "Physics" - a toggle that switches the object between:
//       On  -> a normal physics body (falls under gravity, can be thrown)
//       Off -> frozen in place (no falling, no spinning)
// There is also an X button to close the panel.
//
// The panel is operated with the ray pointer: aim a hand at a button and pull
// the trigger to click it.
// ============================================================================


type ButtonHandle = {
  root: Entity,   // background plane; carries the collider + ray-click
  label: Entity,  // text child, kept so the caption can be updated
}


// Per-entity physics state. A missing entry means "enabled" (a normal Physics body).
const physicsEnabled = new Map<Entity, boolean>();
// Pose (position + rotation) a physics-off entity is pinned to while it isn't held.
const frozen = new Map<Entity, { pos: Vector3, rot: Quaternion }>();


export const propertyPanel = {
  open,
  close,
  isOpen,
  getPhysicsEnabled,
  setPhysicsEnabled,
  setFrozenPose,
};


let panelRoot: Entity | undefined;
let physicsButton: ButtonHandle | undefined;


function isOpen(): boolean {
  return panelRoot !== undefined;
}

function getPhysicsEnabled(entity: Entity): boolean {
  return physicsEnabled.get(entity) ?? true;
}

function setPhysicsEnabled(entity: Entity, enabled: boolean): void {
  physicsEnabled.set(entity, enabled);

  // Drop any stored frozen pose so the freeze loop re-captures the object's
  // current pose next time (it may have just been moved or resized).
  frozen.delete(entity);
}

/**
 * Override the pinned pose used while an entity has physics OFF. Lets another
 * system (e.g. the scale gizmo) move/resize the object without the freeze loop
 * fighting it back to an old pose.
 */
function setFrozenPose(entity: Entity, pos: Vector3, rot: Quaternion): void {
  frozen.set(entity, { pos: pos.clone(), rot: rot.clone() });
}


type OpenOptions = {
  /** If provided, a "Duplicate" button appears that calls this with the target. */
  onDuplicate?: (target: Entity) => void,
}

/**
 * Open the property panel for an entity (closing any panel already open).
 * The panel floats just above the entity and faces the player.
 */
function open(target: Entity, options: OpenOptions = {}): void {
  close();

  // Float above the object, nudged toward the player. A 'Front' plane with no
  // rotation faces +Z, which is toward the player in this scene.
  const anchor = target.pos.add(new Vector3(0, 0.32, 0.12));

  panelRoot = spawnPrimitive.plane(
    'Front',
    anchor,
    new Vector3(0.34, 0.30, 1),
    Quaternion.one,
    new Color(0.12, 0.12, 0.14),
    1,
    'None',
    'Static',
    undefined
  );

  // Title.
  addLabel(panelRoot, new Vector3(0, 0.11, 0.002), 'Properties', 5, Color.white);

  // X close button (top-right corner).
  const closeButton = makeButton(
    panelRoot,
    new Vector3(0.145, 0.115, 0.002),
    new Vector3(0.04, 0.04, 1),
    'X',
    5,
    new Color(0.7, 0.15, 0.15),
    Color.white
  );
  closeButton.root.rayClick.setClickFunction(() => close());

  // "Physics" property row: a label on the left, a toggle button on the right.
  addLabel(panelRoot, new Vector3(-0.08, 0.02, 0.002), 'Physics', 4, Color.white);

  physicsButton = makeButton(
    panelRoot,
    new Vector3(0.08, 0.02, 0.002),
    new Vector3(0.12, 0.07, 1),
    physicsCaption(target),
    4,
    physicsColor(target),
    Color.white
  );
  physicsButton.root.rayClick.setClickFunction(() => {
    setPhysicsEnabled(target, !getPhysicsEnabled(target));
    refreshPhysicsButton(target);
  });

  // Duplicate button (only shown if the caller provided a duplicate handler).
  if (options.onDuplicate) {
    const onDuplicate = options.onDuplicate;

    const dupButton = makeButton(
      panelRoot,
      new Vector3(0, -0.09, 0.002),
      new Vector3(0.22, 0.06, 1),
      'Duplicate',
      4,
      new Color(0.2, 0.35, 0.6),
      Color.white
    );
    dupButton.root.rayClick.setClickFunction(() => onDuplicate(target));
  }
}

function close(): void {
  if (panelRoot) {
    panelRoot.destroy(); // destroys child buttons + text too
  }

  panelRoot = undefined;
  physicsButton = undefined;
}


function physicsCaption(target: Entity): string {
  return getPhysicsEnabled(target) ? 'On' : 'Off';
}

function physicsColor(target: Entity): Color {
  return getPhysicsEnabled(target) ? new Color(0.18, 0.5, 0.2) : new Color(0.4, 0.4, 0.45);
}

function refreshPhysicsButton(target: Entity): void {
  if (physicsButton) {
    physicsButton.label.text.display.set(physicsCaption(target));
    physicsButton.root.mesh.color.set(physicsColor(target), 1);
  }
}


// --- small UI builders ------------------------------------------------------

function addLabel(parent: Entity, pos: Vector3, text: string, fontSize: number, color: Color): Entity {
  const label = new Entity(pos, Quaternion.one, Vector3.one, parent, 'Static');

  label.text.create(text, fontSize, 0);
  label.text.doubleSided.set(false);
  label.text.color.set(color);

  return label;
}

function makeButton(parent: Entity, pos: Vector3, scale: Vector3, text: string, fontSize: number, bgColor: Color, textColor: Color): ButtonHandle {
  const root = spawnPrimitive.plane(
    'Front',
    pos.add(new Vector3(0, 0, 0.0005)),
    scale,
    Quaternion.one,
    bgColor,
    1,
    'Concave', // a collider is required so the ray can hit the button
    'Static',
    parent
  );

  const label = new Entity(new Vector3(0, 0, 0.001), Quaternion.one, Vector3.one, root, 'Static');

  label.text.create(text, fontSize, 0);
  label.text.doubleSided.set(false);
  label.text.color.set(textColor);

  root.rayClick.initialize(false);

  return { root: root, label: label };
}


// --- "physics off" freeze loop ---------------------------------------------
// While an entity has physics disabled and is not being held, pin it in place so
// gravity can't move it. When held, the grab system controls it and we re-pin on
// release.

registerStart(start);
function start() {
  Events.onPhysicsUpdate(onPhysicsUpdate);
}

function onPhysicsUpdate(deltaTime: number) {
  physicsEnabled.forEach((enabled, entity) => {
    if (enabled || !entity.exists()) {
      return;
    }

    if (grabbable.isHeld(entity)) {
      frozen.delete(entity);
      return;
    }

    let pin = frozen.get(entity);

    if (!pin) {
      pin = { pos: entity.pos.clone(), rot: entity.rot.clone() };
      frozen.set(entity, pin);
    }

    // Pin position AND rotation and clear linear velocity, so the object is
    // completely still while physics is off (no falling, no spinning).
    entity.pos = pin.pos;
    entity.rot = pin.rot;
    entity.velocity.set(Vector3.zero);
  });
}
