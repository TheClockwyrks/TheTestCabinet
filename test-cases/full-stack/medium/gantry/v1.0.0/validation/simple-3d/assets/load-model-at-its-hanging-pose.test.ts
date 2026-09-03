// assets/load-model-at-its-hanging-pose — an attached load is drawn where the
// run says it hangs, not left behind where it started.
//
// specs/assets.md, "The models": "The game draws each model wherever its subject
// is: … the hook at the bob turned to the grip's yaw, … and each load at its
// pose, waiting, hanging, or placed."
// specs/instrumentation.md: `setLoadPhase` to `"attached"` "hangs that load on
// the hook exactly as a successful `attach` leaves it", and a snapshot's
// `run.loads[i].pos` is the pose the run holds that load at.
//
// THE POSE IS READ OFF THE RUN, NOT GUESSED. Where a hanging load is depends on
// where the bob is, which depends on the tape, the pendulum and the tick — so
// this point asks the build where the load is (`run.loads[0].pos`) and holds the
// drawing to that. A validator that computed the hanging pose itself would be
// grading its own pendulum.
//
// AND IT IS READ IN WORLD UNITS, which is this engine's half of the point. Under
// this engine the yard is the engine's own retained scene — "what `render` added
// on one frame is still there on the next… this is what lets a check find an
// object by name and read its world position with no pixels involved"
// (`rendering.ts`) — and this process has no GPU, so there is no frame to
// photograph. There are the bodies the build put in the scene, read in the units
// specs/world.md states the class box in.
//
// THE READING IS TWO RUNS OF THE SAME BUILD, DIFFERING ONLY IN THE ATTACHMENT. A
// run is alive while this is read — the clock in the readouts moves and the bob
// settles — so a before-and-after on one page could not tell the crate arriving
// at the hook from a run that simply ticked. specs/instrumentation.md fixes the
// way out: "Gantry uses no randomness anywhere, and a run advances only on its
// fixed tick, so the same structure and the same tape produce the same run, tick
// for tick, every time." Two pages are driven through the same ticks of the same
// run and only one of them is told to hang the load.
//
// WHY THE READING IS A COUNT OF BODIES AND NOT AN EQUALITY. Hanging a load
// legitimately changes the picture away from the load: the members are "colored
// by utilization during a run" (specs/ui.md, specs/assets.md), so the weight now
// on the hook reshades the crane. A validator that held the yard around the hook
// still would be failing a build for doing exactly what the specification asks.
// So what is asked of each of the two boxes is that the two runs draw something
// different THERE — a body in one and not the other —
// and what is asserted is that a large part of the load's own box changed, which
// is what a model being drawn there looks like and what a shift along a color
// ramp cannot produce.
//
// AND BOTH POSES ARE READ, because that is the requirement in one sentence: the
// load is drawn where the run reports it AND is gone from where it started. The
// starting pose is put far from the crane, so nothing but the crate can change
// there.
//
// THE BOB IS PARKED BEFORE THE READING. The tape drives the trolley out and the
// hoist down, which leaves the bob swinging; it is then put straight below the
// pivot at the cable's own length, at rest, which is where the constraint holds
// it. That is a precondition posed through the surface, not an outcome: the run
// goes on ticking under its own rules from there.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertEqual, assertTrue } from "../assert";
import {
  HOIST_MAX_RATE,
  LOAD_CLASS_DIMENSIONS,
  SLEW_MAX_RATE,
  TROLLEY_MAX_RATE,
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

/** The one load: site 1's own crate, started far from the crane and the hook. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 0, y: 2, z: 11, yaw: 0 };

/**
 * The tape: the trolley out along the rail and the hoist down, so the hook hangs
 * in clear air well outboard of the tower, and then a slew so slow that the run
 * keeps running while the frame is read without the yard moving under it.
 */
const TROLLEY_AT = 3.5;
const HOIST_AT = 1.5;
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "trolley", target: TROLLEY_AT, rate: TROLLEY_MAX_RATE },
      { axis: "hoist", target: HOIST_AT, rate: HOIST_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [{ axis: "slew", target: 180, rate: SLEW_MAX_RATE / 1000 }],
  },
];

/** How long the first step is given, and the settling after the bob is parked. */
const MAX_TICKS = 400;
const SETTLE = 4;

/**
 * Ticks taken between readings while the first step runs.
 *
 * The step is the ROUTE to the scenario and not the scenario: what this point
 * reads is the state the step leaves, and the only thing the ticks along the way
 * are asked is whether the step is done yet. So they are driven in blocks — the
 * same frames, the same run — and the state is read once a block rather than
 * once a tick.
 */
const CHUNK = 8;

/**
 * How far past its own class box a load's drawing is held.
 *
 * specs/assets.md says the load models "fill their class boxes" and that the
 * figures are "the intent, not a tolerance", so a quarter of the box's own size
 * is room for whatever a build sculpts on it and still far short of anywhere else
 * in the yard.
 */
const MARGIN_SHARE = 0.25;

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
    const material = (object as THREE.Mesh).material as
      | Partial<THREE.MeshStandardMaterial>
      | undefined;
    found.push({
      signature: [
        object.type,
        box.min
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
        box.max
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
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

/** Stand one page up on the same run, with the bob parked and at rest. */
async function poseRun(harness: Harness): Promise<void> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await harness.debug.addLoad(
    CLASS,
    MASS,
    START.x,
    START.y,
    START.z,
    START.yaw,
  );
  await standMinimalCrane(harness);
  await poseTape(harness, TAPE);
  await startRun(harness);

  let state = await runTicks(harness, CHUNK);
  for (
    let ran = CHUNK;
    ran < MAX_TICKS && state.run.stepIndex < 1 && state.run.phase === "running";
    ran += CHUNK
  ) {
    state = await runTicks(harness, CHUNK);
  }
  assertEqual(
    state.run.stepIndex,
    1,
    `the tape's first step to complete within ${MAX_TICKS} ticks, so the hook ` +
      "stands out along the rail before this point reads the frame",
  );
  assertEqual(state.run.phase, "running", "the run while the frame is read");

  // The bob straight below the pivot at the cable's own length, at rest: the
  // position the constraint holds, so it stays where it is put.
  await harness.debug.setBob(
    state.run.pivot.x,
    state.run.pivot.y - state.run.axes.hoist.value,
    state.run.pivot.z,
  );
  await harness.debug.setBobVelocity(0, 0, 0);
  await runTicks(harness, SETTLE);
}

let free: Harness;
let hanging: Harness;

beforeEach(async () => {
  free = await createHarness();
  hanging = await createHarness();
});

afterEach(async () => {
  await free.dispose();
  await hanging.dispose();
});

it("draws an attached load at the pose the run reports and not at its starting pose", async () => {
  await poseRun(free);
  await poseRun(hanging);

  // The one difference between the two runs: on one, the load is on the hook.
  await hanging.debug.setLoadPhase(0, "attached");
  await hanging.advance(1);
  await free.advance(1);

  const hung = await hanging.snapshot();
  const loose = await free.snapshot();
  assertEqual(
    hung.run.loads[0]?.phase,
    "attached",
    "the phase the posed load holds, which this point is about " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    loose.run.loads[0]?.phase,
    "waiting",
    "the load on the run that was told nothing, so the two runs differ in " +
      "the attachment alone",
  );
  assertEqual(
    hung.run.phase,
    "running",
    "the run carrying the load, which must still be running for the hanging " +
      "pose to be the one drawn",
  );

  const at = hung.run.loads[0]!;
  const onHook = around({ x: at.pos.x, y: at.pos.y, z: at.pos.z, yaw: at.yaw });
  const atStart = around(START);
  assertTrue(
    !onHook.intersectsBox(atStart),
    "the load's starting pose and its hanging pose to stand apart, so the " +
      "two readings this point takes are of two different places",
  );

  const parted = differing(bodies(free), bodies(hanging));
  await hanging.capture("hanging", "The attached load hanging from the hook");

  assertTrue(
    parted.some((body) => onHook.containsBox(body.box)),
    "the yard to draw a body inside the class box at the pose the run reports " +
      `for the attached load — (${at.pos.x.toFixed(2)}, ` +
      `${at.pos.y.toFixed(2)}, ${at.pos.z.toFixed(2)}) — that the run leaving ` +
      "the load waiting does not, since the game draws each load at its pose " +
      "and an attached load hangs from the hook (specs/assets.md)",
  );

  assertTrue(
    parted.some((body) => atStart.containsBox(body.box)),
    "the yard to draw a body inside the class box at the load's starting pose " +
      `(${START.x}, ${START.y}, ${START.z}) on the run that left it waiting ` +
      "and not on the run that hung it, since a load that hangs from the hook " +
      "is no longer drawn where it started (specs/assets.md)",
  );
});
