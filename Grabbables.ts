import { Color } from "./Yuu API/Basic Types/Color";
import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { inWorldConsole } from "./Yuu API/Console";
import { grabbable } from "./Yuu API/Grabbable";
import { registerStart } from "./Yuu API/RegisterStart";
import { spawnPrimitive } from "./Yuu API/SpawnPrimitive";


// ============================================================================
// Grabbables - first project scene
// ----------------------------------------------------------------------------
// Goal for today: spawn a cube and let the player grab it when a hand is close.
//
// How grabbing works (handled by Yuu API/Grabbable.ts):
//   1. Move a controller/hand within the cube's grab radius.
//   2. Squeeze the grip button -> the nearest cube in range attaches to the hand.
//   3. Release the grip -> the cube drops, keeping the hand's motion (so you can
//      throw it). Throwing only works on 'Physics' entities.
// ============================================================================


// registerStart queues this function to run once when the scene starts.
registerStart(start);

function start() {
  // Floating debug console so we can read logs from inside the headset.
  inWorldConsole.visible(true, new Vector3(0, 2, -2));

  // ---- Floor ----------------------------------------------------------------
  // A static plane to catch the cube when it is dropped or thrown.
  spawnPrimitive.plane(
    'Front',                                              // which side(s) to draw
    Vector3.zero,                                         // position (world origin)
    new Vector3(10, 10, 1),                               // 10m x 10m
    Quaternion.fromEuler(new Vector3(-Math.PI / 2, 0, 0)), // lay flat (rotate -90 deg on X)
    new Color(0.5, 0.5, 0.5),                            // grey
    1,                                                    // fully opaque
    'Concave',                                            // collider type
    'Static',                                             // never moves
    undefined                                             // no parent
  );

  // ---- Grabbable cube -------------------------------------------------------
  // Must be a 'Physics' entity so it responds to gravity and can be thrown.
  const cube = spawnPrimitive.cube(
    new Vector3(0, 1.2, -0.5),  // ~1.2m up, 0.5m in front of the player
    new Vector3(0.2, 0.2, 0.2), // 20cm cube
    Quaternion.one,             // no rotation
    Color.red,                  // red
    1,                          // fully opaque
    true,                       // give it a collider
    'Physics',                  // physics body (gravity + throwable)
    undefined                   // no parent
  );

  // Register the cube with the grab system.
  // grabRadius = how close (in meters) a hand must be to grab it.
  grabbable.make(cube, 0.2, {
    onGrab: (hand) => console.log(hand + ' hand grabbed the cube'),
    onRelease: (hand) => console.log(hand + ' hand released the cube'),
  });

  console.log('Grabbables ready: move a hand near the cube and squeeze grip to grab.');
}
