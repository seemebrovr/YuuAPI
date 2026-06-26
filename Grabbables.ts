import { Color } from "./Yuu API/Basic Types/Color";
import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { inWorldConsole } from "./Yuu API/Console";
import { Controller } from "./Yuu API/Controller";
import { Entity } from "./Yuu API/Entity";
import { grabbable, Hand } from "./Yuu API/Grabbable";
import { Player } from "./Yuu API/Player";
import { propertyPanel } from "./Yuu API/PropertyPanel";
import { registerStart } from "./Yuu API/RegisterStart";
import { scaleGizmo } from "./Yuu API/ScaleGizmo";
import { spawnMenu } from "./Yuu API/SpawnMenu";
import { spawnPrimitive } from "./Yuu API/SpawnPrimitive";


// ============================================================================
// Grabbables - first project scene
// ----------------------------------------------------------------------------
// A table with a grabbable cube on top. You can:
//   - Grab a cube anywhere on its surface (squeeze grip) and throw it.
//   - Select it (point + trigger) to show XYZ handles, then drag a face handle
//     to resize that one side.
//   - While holding it, click the thumbstick to open its property panel
//     (Physics on/off, Duplicate).
// (No floor, so anything that falls off the table keeps falling.)
// ============================================================================


// Wood-ish colors for the table.
const tableTopColor = new Color(0.45, 0.30, 0.18);
const tableLegColor = new Color(0.35, 0.23, 0.13);

// Where the table stands and how big it is (meters).
const tableCenter = new Vector3(0, 0, -0.6);
const topThickness = 0.05;
const topWidth = 0.8;
const topDepth = 0.5;
const legHeight = 1.05;
const legThickness = 0.05;

const tableSurfaceY = tableCenter.y + legHeight + topThickness;

// The starting cube.
const cubeSize = 0.2;     // 20cm cube
const grabReach = 0.07;   // how close (m) a hand must be to a cube's surface to grab it
const cubeBlue = new Color(0.2, 0.45, 1);


registerStart(start);

function start() {
  inWorldConsole.visible(true, new Vector3(0, 2, -2));

  makeTable();

  // Starting cube resting on the table.
  spawnGrabbableCube(
    new Vector3(tableCenter.x, tableSurfaceY + (cubeSize / 2), tableCenter.z),
    new Vector3(cubeSize, cubeSize, cubeSize),
    Quaternion.one,
    Color.red
  );

  // While holding a cube, click that hand's thumbstick to open/close its panel.
  const togglePanel = (hand: Hand) => {
    const held = grabbable.heldEntity(hand);

    if (!held) {
      return; // this hand isn't holding anything
    }

    if (propertyPanel.isOpen()) {
      propertyPanel.close();
    }
    else {
      propertyPanel.open(held, { onDuplicate: duplicateCube });
    }
  };

  Controller.subscribe('leftThumbstick', 'Pressed', () => togglePanel('Left'));
  Controller.subscribe('rightThumbstick', 'Pressed', () => togglePanel('Right'));

  // Spawn menu: press the left X button to open a palette in front of you, then
  // click a color to spawn that cube straight into the hand you clicked with.
  spawnMenu.configure([
    { label: 'Red', color: Color.red, onSpawn: (hand) => spawnIntoHand(hand, Color.red) },
    { label: 'Green', color: Color.green, onSpawn: (hand) => spawnIntoHand(hand, Color.green) },
    { label: 'Blue', color: cubeBlue, onSpawn: (hand) => spawnIntoHand(hand, cubeBlue) },
  ]);

  console.log('Grabbables ready: grab a cube by its surface and squeeze grip.');
}


/**
 * Spawn a red physics cube that can be grabbed (anywhere on its surface),
 * resized (select it, then drag a face handle), and duplicated (property panel).
 */
function spawnGrabbableCube(pos: Vector3, scale: Vector3, rot: Quaternion, color: Color): Entity {
  const cube = spawnPrimitive.cube(pos, scale, rot, color, 1, true, 'Physics', undefined);

  // Grab anywhere within grabReach of the cube's surface.
  grabbable.make(cube, grabReach, {
    grabBox: new Vector3(scale.x / 2, scale.y / 2, scale.z / 2),
    snapGrid: 0.1, // 10cm grid, used when Snap is turned on in the property panel
    onGrab: (hand) => console.log(hand + ' hand grabbed a cube'),
    onRelease: (hand) => console.log(hand + ' hand released a cube'),
  });

  // Resize handles; keep the grab box in sync as the cube is stretched.
  scaleGizmo.attach(cube, {
    onScale: (s) => grabbable.setGrabBox(cube, new Vector3(s.x / 2, s.y / 2, s.z / 2)),
  });

  // Spawn with physics OFF so it stays where you place it (toggle it on in the panel).
  propertyPanel.setPhysicsEnabled(cube, false);

  return cube;
}


/**
 * Duplicate: make another cube with the same size, rotation and color as the
 * target, placed just beside it.
 */
function duplicateCube(target: Entity): void {
  const scale = target.scale;
  const rot = target.rot;

  const colorInfo = target.mesh.color.get();
  const color = colorInfo ? colorInfo.color : Color.red;

  // Offset along world X by the cube's width + a small gap, so it doesn't overlap.
  const pos = target.pos.add(new Vector3(scale.x + 0.1, 0, 0));

  spawnGrabbableCube(pos, scale, rot, color);
}


// Spawn a cube and place it straight into the given hand (used by the spawn menu).
function spawnIntoHand(hand: Hand, color: Color): void {
  const handPos = (hand === 'Left'
    ? Player.leftHand.position.get()
    : Player.rightHand.position.get()) ?? new Vector3(0, 1.4, -0.4);

  const cube = spawnGrabbableCube(handPos, new Vector3(cubeSize, cubeSize, cubeSize), Quaternion.one, color);

  grabbable.forceGrab(cube, hand);
}


// Builds a simple table (one top + four legs) from static cubes.
function makeTable() {
  const topY = tableCenter.y + legHeight + (topThickness / 2);

  spawnPrimitive.cube(
    new Vector3(tableCenter.x, topY, tableCenter.z),
    new Vector3(topWidth, topThickness, topDepth),
    Quaternion.one,
    tableTopColor,
    1,
    true,
    'Static',
    undefined
  );

  const legOffsetX = (topWidth / 2) - legThickness;
  const legOffsetZ = (topDepth / 2) - legThickness;
  const legY = tableCenter.y + (legHeight / 2);

  const legPositions = [
    new Vector3(tableCenter.x - legOffsetX, legY, tableCenter.z - legOffsetZ),
    new Vector3(tableCenter.x + legOffsetX, legY, tableCenter.z - legOffsetZ),
    new Vector3(tableCenter.x - legOffsetX, legY, tableCenter.z + legOffsetZ),
    new Vector3(tableCenter.x + legOffsetX, legY, tableCenter.z + legOffsetZ),
  ];

  legPositions.forEach((legPos) => {
    spawnPrimitive.cube(
      legPos,
      new Vector3(legThickness, legHeight, legThickness),
      Quaternion.one,
      tableLegColor,
      1,
      true,
      'Static',
      undefined
    );
  });
}
