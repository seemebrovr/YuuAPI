import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Events } from "./Events";
import { grabbable, Hand } from "./Grabbable";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";
import { scaleGizmo } from "./ScaleGizmo";


// ============================================================================
// EditMode - a free-fly build mode.
// ----------------------------------------------------------------------------
//  - Toggle by clicking BOTH thumbsticks in at once.
//  - In edit mode the GRIP is for flying and the TRIGGER is for holding/stretching
//    objects, so you can move and manipulate at the same time:
//      * One grip in empty space: pull yourself through the world.
//      * Both grips: pull (move), TWIST to turn, SPREAD/CLOSE to zoom.
//      * Trigger near an object: grab/hold it. Trigger near a resize handle: drag.
//  - Leaving edit mode restores grip-grabbing.
//
// All movement is measured against the rig's ACTUAL transform each frame (closed
// loop) and clamped, so nothing can run away.
// ============================================================================


type HandFlags = { Left: boolean, Right: boolean };
const hands: Hand[] = ['Left', 'Right'];

const dollyGain = 2.5;
const minZoomDist = 0.25;
const maxStep = 0.3;
const maxTwist = 1.0;

let active = false;
let flyPos = Vector3.zero;
let flyRot = Quaternion.one;

const gripDown: HandFlags = { Left: false, Right: false };
const thumbDown: HandFlags = { Left: false, Right: false };
let bothThumbsActive = false;

let wasOneHand = false;
let oneHandWhich: Hand | undefined = undefined;
let lastOneLocal = Vector3.zero;

let wasTwoHand = false;
let lastTwoAvg = Vector3.zero;
let lastTwoBearing = 0;
let lastTwoDist = 0;

const modeChangeCallbacks: ((isActive: boolean) => void)[] = [];


export const editMode = {
  isActive: (): boolean => active,
  bothThumbsticksDown: (): boolean => thumbDown.Left && thumbDown.Right,
  onModeChange: (callback: (isActive: boolean) => void): void => { modeChangeCallbacks.push(callback); },
}


function setActive(value: boolean): void {
  if (value === active) { return; }
  active = value;

  // In edit mode, grip is for flying, so grabbing moves to the trigger.
  grabbable.setGripEnabled(!active);
  scaleGizmo.setGripEnabled(!active);

  if (active) {
    const p = Player.position.get();
    const r = Player.rotation.get();
    flyPos = p ? p.clone() : Vector3.zero;
    flyRot = r ? r.clone() : Quaternion.one;
    wasOneHand = false;
    wasTwoHand = false;
    console.log('Edit mode: ON - grip to move, trigger to hold/stretch');
  }
  else {
    console.log('Edit mode: OFF');
  }

  modeChangeCallbacks.forEach((callback) => callback(active));
}


function handPos(hand: Hand): Vector3 | undefined { return hand === 'Left' ? Player.leftHand.position.get() : Player.rightHand.position.get(); }
function yawQuaternion(angle: number): Quaternion { return Quaternion.fromEuler(new Vector3(0, angle, 0)); }


registerStart(start);
function start() {
  Controller.subscribe('leftThumbstick', 'Pressed', () => onThumbPressed('Left'));
  Controller.subscribe('rightThumbstick', 'Pressed', () => onThumbPressed('Right'));
  Controller.subscribe('leftThumbstick', 'Released', () => onThumbReleased('Left'));
  Controller.subscribe('rightThumbstick', 'Released', () => onThumbReleased('Right'));

  Controller.subscribe('leftGrip', 'Pressed', () => { gripDown.Left = true; });
  Controller.subscribe('leftGrip', 'Released', () => { gripDown.Left = false; });
  Controller.subscribe('rightGrip', 'Pressed', () => { gripDown.Right = true; });
  Controller.subscribe('rightGrip', 'Released', () => { gripDown.Right = false; });

  // In edit mode the trigger grabs/holds objects and drags resize handles.
  Controller.subscribe('leftTrigger', 'Pressed', () => onTriggerPressed('Left'));
  Controller.subscribe('rightTrigger', 'Pressed', () => onTriggerPressed('Right'));
  Controller.subscribe('leftTrigger', 'Released', () => onTriggerReleased('Left'));
  Controller.subscribe('rightTrigger', 'Released', () => onTriggerReleased('Right'));

  Events.onPhysicsUpdate(onPhysicsUpdate);
}

function onThumbPressed(hand: Hand): void {
  thumbDown[hand] = true;
  if (thumbDown.Left && thumbDown.Right && !bothThumbsActive) {
    bothThumbsActive = true;
    setActive(!active);
  }
}

function onThumbReleased(hand: Hand): void {
  thumbDown[hand] = false;
  if (!(thumbDown.Left && thumbDown.Right)) { bothThumbsActive = false; }
}

function onTriggerPressed(hand: Hand): void {
  if (!active) { return; }
  grabbable.grab(hand);       // grab a nearby object...
  scaleGizmo.startDrag(hand); // ...or start a resize-handle drag (skipped if grabbed)
}

function onTriggerReleased(hand: Hand): void {
  if (!active) { return; }
  grabbable.releaseHand(hand);
  scaleGizmo.stopDrag(hand);
}


function onPhysicsUpdate(deltaTime: number): void {
  if (!active) { return; }

  const rigPos = Player.position.get();
  const rigRot = Player.rotation.get();
  if (!rigPos || !rigRot) { return; }

  // Grip is pure locomotion in edit mode (grabbing is on the trigger), so any
  // gripping hand moves you - even while you hold/stretch an object on the trigger.
  const gripping = hands.filter((hand) => gripDown[hand]);

  if (gripping.length >= 2) { twoHandMove(rigPos, rigRot); wasOneHand = false; }
  else if (gripping.length === 1) { oneHandMove(gripping[0], rigPos, rigRot); wasTwoHand = false; }
  else { wasOneHand = false; wasTwoHand = false; }

  Player.position.set(flyPos);
  Player.rotation.set(flyRot);
}


function oneHandMove(hand: Hand, rigPos: Vector3, rigRot: Quaternion): void {
  const hw = handPos(hand);
  if (!hw) { wasOneHand = false; return; }
  const local = rigRot.inverse().rotateVector(hw.subtract(rigPos));
  if (wasOneHand && oneHandWhich === hand) {
    const delta = local.subtract(lastOneLocal);
    if (delta.magnitude() < maxStep) { flyPos = flyPos.subtract(rigRot.rotateVector(delta)); }
  }
  lastOneLocal = local;
  oneHandWhich = hand;
  wasOneHand = true;
}

function twoHandMove(rigPos: Vector3, rigRot: Quaternion): void {
  const hl = handPos('Left');
  const hr = handPos('Right');
  if (!hl || !hr) { wasTwoHand = false; return; }

  const invRot = rigRot.inverse();
  const localL = invRot.rotateVector(hl.subtract(rigPos));
  const localR = invRot.rotateVector(hr.subtract(rigPos));
  const avg = localL.add(localR).multiply(0.5);
  const between = localR.subtract(localL);
  const bearing = Math.atan2(between.x, between.z);
  const dist = between.magnitude();

  if (wasTwoHand) {
    const avgDelta = avg.subtract(lastTwoAvg);
    if (avgDelta.magnitude() < maxStep) { flyPos = flyPos.subtract(rigRot.rotateVector(avgDelta)); }

    let twist = bearing - lastTwoBearing;
    while (twist > Math.PI) { twist -= 2 * Math.PI; }
    while (twist < -Math.PI) { twist += 2 * Math.PI; }
    if (Math.abs(twist) < maxTwist) {
      const yaw = yawQuaternion(-twist);
      const head = Player.head.position.get();
      if (head) { flyPos = head.add(yaw.rotateVector(flyPos.subtract(head))); }
      flyRot = yaw.multiply(flyRot);
    }

    const distDelta = dist - lastTwoDist;
    const head2 = Player.head.position.get();
    if (head2 && Math.abs(distDelta) < maxStep) {
      const midWorld = hl.add(hr).multiply(0.5);
      const toObject = midWorld.subtract(head2);
      const objDist = toObject.magnitude();
      if (objDist > 0.001) {
        const dollyDir = toObject.divide(objDist);
        let along = -distDelta * dollyGain;
        if (along > 0) { along = Math.min(along, Math.max(0, objDist - minZoomDist)); }
        flyPos = flyPos.add(dollyDir.multiply(along));
      }
    }
  }

  lastTwoAvg = avg;
  lastTwoBearing = bearing;
  lastTwoDist = dist;
  wasTwoHand = true;
}
