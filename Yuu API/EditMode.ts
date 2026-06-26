import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Events } from "./Events";
import { grabbable, Hand } from "./Grabbable";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";


// ============================================================================
// EditMode - a free-fly build mode.
// ----------------------------------------------------------------------------
//  - Toggle by clicking BOTH thumbsticks in at once.
//  - One grip in empty space: PULL yourself through the world.
//  - Both grips in empty space: pull (move), TWIST your hands to turn (yaw),
//    and SPREAD/CLOSE your hands to zoom in/out (dolly toward/away your view).
//  - Gripping while HOLDING an object never moves you - so grabbing or stretching
//    an object can't fling the camera. (You fly with empty hands.)
//
// All movement is measured against the rig's ACTUAL transform each frame (closed
// loop) and clamped, so nothing can run away.
// ============================================================================


type HandFlags = { Left: boolean, Right: boolean };

const hands: Hand[] = ['Left', 'Right'];

const dollyGain = 2.5;       // meters moved per meter of hand-spread change (zoom strength)
const maxStep = 0.3;         // ignore implausible per-frame position jumps (m)
const maxTwist = 1.0;        // ignore implausible per-frame twists (radians)


let active = false;

// The rig transform we drive toward while in edit mode.
let flyPos = Vector3.zero;
let flyRot = Quaternion.one;

// Button down-states + toggle debounce.
const gripDown: HandFlags = { Left: false, Right: false };
const thumbDown: HandFlags = { Left: false, Right: false };
let bothThumbsActive = false;

// One-hand locomotion tracking.
let wasOneHand = false;
let oneHandWhich: Hand | undefined = undefined;
let lastOneLocal = Vector3.zero;

// Two-hand locomotion tracking.
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
  if (value === active) {
    return;
  }

  active = value;

  if (active) {
    const p = Player.position.get();
    const r = Player.rotation.get();

    flyPos = p ? p.clone() : Vector3.zero;
    flyRot = r ? r.clone() : Quaternion.one;

    wasOneHand = false;
    wasTwoHand = false;

    console.log('Edit mode: ON - one grip to move, two grips to move/turn/zoom');
  }
  else {
    console.log('Edit mode: OFF');
  }

  modeChangeCallbacks.forEach((callback) => callback(active));
}


function handPos(hand: Hand): Vector3 | undefined {
  return hand === 'Left' ? Player.leftHand.position.get() : Player.rightHand.position.get();
}

function yawQuaternion(angle: number): Quaternion {
  return Quaternion.fromEuler(new Vector3(0, angle, 0));
}


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

  if (!(thumbDown.Left && thumbDown.Right)) {
    bothThumbsActive = false;
  }
}


function onPhysicsUpdate(deltaTime: number): void {
  if (!active) {
    return;
  }

  const rigPos = Player.position.get();
  const rigRot = Player.rotation.get();

  if (!rigPos || !rigRot) {
    return;
  }

  // The fix: while a hand is holding an object, gripping does NOT move you, so
  // grabbing or two-hand stretching an object can't fling the camera.
  const holdingObject = grabbable.heldEntity('Left') !== undefined || grabbable.heldEntity('Right') !== undefined;

  const gripping = holdingObject ? [] : hands.filter((hand) => gripDown[hand]);

  if (gripping.length >= 2) {
    twoHandMove(rigPos, rigRot);
    wasOneHand = false;
  }
  else if (gripping.length === 1) {
    oneHandMove(gripping[0], rigPos, rigRot);
    wasTwoHand = false;
  }
  else {
    wasOneHand = false;
    wasTwoHand = false;
  }

  // Drive the rig toward our target (holds you floating + applies movement/turn).
  Player.position.set(flyPos);
  Player.rotation.set(flyRot);
}


function oneHandMove(hand: Hand, rigPos: Vector3, rigRot: Quaternion): void {
  const hw = handPos(hand);

  if (!hw) {
    wasOneHand = false;
    return;
  }

  // Hand position in the rig's local frame (physical, independent of where/how
  // the rig is placed) so it can't feed back into itself.
  const local = rigRot.inverse().rotateVector(hw.subtract(rigPos));

  if (wasOneHand && oneHandWhich === hand) {
    const delta = local.subtract(lastOneLocal);

    if (delta.magnitude() < maxStep) {
      flyPos = flyPos.subtract(rigRot.rotateVector(delta)); // move opposite the hand
    }
  }

  lastOneLocal = local;
  oneHandWhich = hand;
  wasOneHand = true;
}


function twoHandMove(rigPos: Vector3, rigRot: Quaternion): void {
  const hl = handPos('Left');
  const hr = handPos('Right');

  if (!hl || !hr) {
    wasTwoHand = false;
    return;
  }

  const invRot = rigRot.inverse();
  const localL = invRot.rotateVector(hl.subtract(rigPos));
  const localR = invRot.rotateVector(hr.subtract(rigPos));

  const avg = localL.add(localR).multiply(0.5);
  const between = localR.subtract(localL);
  const bearing = Math.atan2(between.x, between.z);
  const dist = between.magnitude();

  if (wasTwoHand) {
    // --- Translate: move opposite the midpoint's motion ---
    const avgDelta = avg.subtract(lastTwoAvg);

    if (avgDelta.magnitude() < maxStep) {
      flyPos = flyPos.subtract(rigRot.rotateVector(avgDelta));
    }

    // --- Rotate (yaw): twist of the two hands turns you, pivoting on your head ---
    let twist = bearing - lastTwoBearing;
    while (twist > Math.PI) { twist -= 2 * Math.PI; }
    while (twist < -Math.PI) { twist += 2 * Math.PI; }

    if (Math.abs(twist) < maxTwist) {
      const yaw = yawQuaternion(-twist);
      const head = Player.head.position.get();

      if (head) {
        flyPos = head.add(yaw.rotateVector(flyPos.subtract(head))); // pivot on the head
      }

      flyRot = yaw.multiply(flyRot);
    }

    // --- Zoom (dolly): spread/close the hands to move along your view ---
    const distDelta = dist - lastTwoDist;

    if (Math.abs(distDelta) < maxStep) {
      const forward = Player.forward.get();

      if (forward) {
        flyPos = flyPos.add(forward.multiply(distDelta * dollyGain)); // spread = forward (zoom in)
      }
    }
  }

  lastTwoAvg = avg;
  lastTwoBearing = bearing;
  lastTwoDist = dist;
  wasTwoHand = true;
}
