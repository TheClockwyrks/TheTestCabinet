// assets/load-model-at-its-placed-pose — a placed load is drawn on its pad.
//
// specs/assets.md, "The models": "The game draws each model wherever its subject
// is: … and each load at its pose, waiting, hanging, or placed."
// specs/world.md, "Loads": "A placed load sits at exactly its target pose for
// the rest of the run."
//
// THE READING IS TWO RUNS OF THE SAME BUILD, ONE TICK APART FROM EACH OTHER IN
// NOTHING BUT THE LOAD'S PHASE. A run is alive while this is read — the clock in
// the readouts moves, the bob swings, the members recolor — so a before-and-
// after on one page could not tell the crate appearing on its pad from a run
// that simply ticked. specs/instrumentation.md fixes the way out: "Gantry uses
// no randomness anywhere, and a run advances only on its fixed tick, so the same
// structure and the same tape produce the same run, tick for tick, every time."
// So two pages are driven through the same ticks of the same run, and only one
// of them is told to set the load down. Everything either page draws that is not
// the load is then IDENTICAL, and the whole frame can be held to that.
//
// POSING THE PHASE CHANGES NOTHING THE SIMULATION READS: a waiting load and a
// placed load both hang from nothing and are solid to nothing (specs/world.md,
// specs/collisions), so the two runs stay tick-for-tick the same.
//
// WHAT IS ASSERTED. Everything the two yards draw differently stands INSIDE the
// class box at the target pose: the placed load is drawn at exactly its target
// pose and not beside it, and nothing else in the yard moves for it.
//
// AND THAT IS READ IN WORLD UNITS, which is this engine's half of the point.
// Under this engine the yard is the engine's own retained scene — "what `render`
// added on one frame is still there on the next… this is what lets a check find
// an object by name and read its world position with no pixels involved"
// (`rendering.ts`) — and this process has no GPU, so there is no frame to
// photograph. There are the bodies the build put in the scene, read in the units
// specs/world.md states the class box in.
//
// THE RING IS THE YARD AROUND THE PAD, NOT THE WHOLE FRAME. specs/ui.md fixes
// what the run screen's readouts show, but a build is free to put more beside
// them — how many loads are placed, say — and holding the whole frame still
// would fail such a build for a flourish the specification neither asks for nor
// forbids. Where the load itself is drawn is not something a build is free
// about, so the ring is what is held still, and it is checked to stand clear of
// the load's starting pose so that the crate LEAVING that pose is not read as
// the crate arriving beside this one.
//
// THE MARGIN IS AN HONEST TOLERANCE: the models "fill their class boxes" and the
// figures are "the intent, not a tolerance" (specs/assets.md), and a build draws
// the pad and its yaw mark under a placed load as well, so a few logical pixels
// fall outside the mathematical hull.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertEqual, assertTrue, fail } from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_START,
  LOAD_CLASS_DIMENSIONS,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type LoadPose,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The one load: a crate that starts well clear of the crane and its pad. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 8, y: 2, z: -4, yaw: 0 };
const TARGET: LoadPose = { x: -2, y: 2, z: 8, yaw: 0 };

/** Enough tape for a run to start and keep running while the frame is read. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 4, rate: HOIST_MAX_RATE / 8 },
    ],
  },
];

/** The tick both runs are read at, past the run's first. */
const READ_AT = 20;

/** Slack around a projected hull, as a share of the box's own drawn size. */
const MARGIN_SHARE = 0.25;

/** Stand one page up on the same run, and leave it one tick short of the read. */
async function poseRun(harness: Harness): Promise<void> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await harness.debug.addLoad(CLASS, MASS, START.x, START.y, START.z, START.yaw);
  await harness.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, TARGET.yaw);
  await standMinimalCrane(harness);
  await poseTape(harness, TAPE);
  await startRun(harness);
  const state = await runTicks(harness, READ_AT);
  assertEqual(
    state.run.phase,
    "running",
    `the run to still be running at tick ${READ_AT}, which is where this ` +
      "point reads both pages",
  );
  assertEqual(
    state.run.loads[0]?.phase,
    "waiting",
    "the load to be waiting on both pages before either is told to set it down",
  );
}

/** One body the yard shows, and where it stands in the world. */
interface Body {
  signature: string;
  box: THREE.Box3;
}

/**
 * Every body the yard SHOWS, with its world extent.
 *
 * Hidden bodies draw nothing: a build is free to keep a pool and hide what it is
 * not using, and the engine's scene retains both.
 */
function bodies(harness: Harness): Body[] {
  const found: Body[] = [];
  harness.engine.scene.traverse((object) => {
    const drawn = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isPoints?: boolean;
    };
    if (
      drawn.isMesh !== true &&
      drawn.isLine !== true &&
      drawn.isPoints !== true
    ) {
      return;
    }
    for (
      let node: THREE.Object3D | null = object;
      node !== null;
      node = node.parent
    ) {
      if (!node.visible) return;
    }
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial> | undefined;
    found.push({
      signature: [
        object.type,
        box.min.toArray().map((one) => one.toFixed(3)).join(),
        box.max.toArray().map((one) => one.toFixed(3)).join(),
        material?.color?.getHexString() ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Every body one reading shows that the other does not, either way round. */
function differing(before: readonly Body[], after: readonly Body[]): Body[] {
  const was = new Set(before.map((body) => body.signature));
  const now = new Set(after.map((body) => body.signature));
  return [
    ...after.filter((body) => !was.has(body.signature)),
    ...before.filter((body) => !now.has(body.signature)),
  ];
}

/** The class box a load of `CLASS` occupies at `pose` (specs/world.md). */
function classBox(pose: {
  x: number;
  y: number;
  z: number;
  yaw: number;
}): THREE.Box3 {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const radians = (pose.yaw * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const box = new THREE.Box3();
  for (const dx of [-size.x / 2, size.x / 2]) {
    for (const dz of [-size.z / 2, size.z / 2]) {
      for (const dy of [-size.y, 0]) {
        box.expandByPoint(
          new THREE.Vector3(
            pose.x + dx * cos - dz * sin,
            pose.y + dy,
            pose.z + dx * sin + dz * cos,
          ),
        );
      }
    }
  }
  return box;
}

/** That box with room around it for whatever a build draws on the model. */
function around(pose: {
  x: number;
  y: number;
  z: number;
  yaw: number;
}): THREE.Box3 {
  const box = classBox(pose);
  const size = box.getSize(new THREE.Vector3());
  return box.expandByScalar(MARGIN_SHARE * Math.max(size.x, size.y, size.z));
}

let waiting: Harness;
let placed: Harness;

beforeEach(async () => {
  waiting = await createHarness();
  placed = await createHarness();
});

afterEach(async () => {
  await waiting.dispose();
  await placed.dispose();
});

it("draws a placed load inside its class box at its target pose", async () => {
  await poseRun(waiting);
  await poseRun(placed);

  const before = bodies(waiting);

  // The one difference between the two runs: on one, the load is set down.
  await placed.debug.setLoadPhase(0, "placed");
  await placed.advance(1);
  await waiting.advance(1);

  const settled = await placed.snapshot();
  assertEqual(
    settled.run.loads[0]?.phase,
    "placed",
    "the phase the posed load holds, which this point is about " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    settled.run.loads[0]?.pos.x,
    TARGET.x,
    "the placed load's lift point, which sits at exactly its target pose " +
      "(specs/world.md)",
  );

  const still = bodies(waiting);
  const set = bodies(placed);
  await placed.capture("placed", "The placed load on its pad");

  // The two runs are the same run, tick for tick, so what the waiting one drew
  // differently across the tick is what a tick alone accounts for; anything the
  // placed one draws differently from the waiting one at the same tick is the
  // load being set down.
  const ticked = differing(before, still);
  const parted = differing(still, set);
  const onPad = around(TARGET);
  assertTrue(
    parted.some((body) => onPad.containsBox(body.box)),
    "the yard to draw a body inside the class box at the target pose " +
      `(${TARGET.x}, ${TARGET.y}, ${TARGET.z}) that the run leaving the load ` +
      "waiting does not, since the game draws each load at its pose and a " +
      "placed load sits at exactly its target pose (specs/assets.md, " +
      "specs/world.md)",
  );
  assertTrue(
    !onPad.intersectsBox(around(START)),
    "the load's starting pose to stand clear of its target's own box, so the " +
      "crate leaving one is never read as the crate arriving beside the " +
      "other — the two poses this point uses are far apart",
  );

  // The load is drawn at its pad on one run and at its starting pose on the
  // other, so both boxes are where the two runs are expected to differ; what
  // this point is about is that they differ NOWHERE ELSE.
  const atStart = around(START);
  const moved = parted.filter(
    (body) =>
      !onPad.containsBox(body.box) &&
      !atStart.containsBox(body.box) &&
      !ticked.some((one) => one.signature === body.signature),
  );
  if (moved.length > 0) {
    const one = moved[0]!;
    fail(
      "everything the two runs draw differently to stand inside the class " +
        `box at the target pose (${TARGET.x}, ${TARGET.y}, ${TARGET.z}), ` +
        `within a ${MARGIN_SHARE} share of that box: a placed load sits at ` +
        "exactly its target pose and is drawn there rather than beside it " +
        "(specs/assets.md, specs/world.md)",
      `${moved.length} of the ${parted.length} bodies that differ stand ` +
        `elsewhere: one spans (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
        `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }
});
