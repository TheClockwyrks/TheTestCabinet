// assets/load-model-at-its-hanging-pose — an attached load is drawn where the
// run says it hangs, not left behind where it started.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … and each load at its pose, waiting, hanging, or placed."
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
// WHERE A LOAD IS DRAWN, UNDER AN ENGINE. specs/assets.md has an engine build
// load each model "through the engine's own asset loader under its asset root",
// so a load on screen is a `ModelComponent` the world holds, built over the
// decode of the committed file `specs/assets.md` names for that load class.
// `drawnFromModel` answers the placements of that one file — it decodes the file
// for itself through the same loader and matches a component's model against it
// by contents — and `drawnModelBox` answers the box each placement FILLS.
//
// AND A LOAD'S POSE IS ITS LIFT POINT. specs/world.md: "Every load pose in this
// specification is the pose of the load's lift point: the center of its top
// face. … The load's box extends half its width and half its depth horizontally
// from the lift point, rotated by its yaw, and its full height below it." So the
// middle of the class box hanging under the pose is the point the drawing is held
// to, and the models "fill their class boxes" (specs/assets.md).
//
// THE ENGINELESS PROJECT DECIDES THIS BY PHOTOGRAPHING THE STAGE and comparing
// what changed inside the box's projection against what changed outside it. There
// is no rasterizer here — `validation/host.ts` gives three a WebGL2 context that
// answers every call and draws nothing — so the reading is the picture's contents
// rather than its pixels.
//
// AND BOTH POSES ARE READ, because that is the requirement in one sentence: the
// load is drawn where the run reports it AND is gone from where it started. The
// starting pose is put far from the crane, so the two boxes cannot overlap.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  HOIST_MAX_RATE,
  LOAD_CLASS_DIMENSIONS,
  SLEW_MAX_RATE,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type LoadPose,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The one load: a crate started far from the crane and the hook. */
const CLASS = "crate" as const;
const MODEL = "models/crate.glb";
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
const MAX_TICKS = 900;
const SETTLE = 4;

/**
 * How far outside the box a model fills the load's own middle may stand.
 *
 * specs/assets.md has the three load models "fill their class boxes" and says the
 * figures "are the intent, not a tolerance", so a sculpt may fall a little short
 * of the middle. A quarter of a unit is two voxels at `VOXELS_PER_UNIT` (`8`) and
 * an eighth of the crate's own two-unit box.
 */
const SLACK = 0.25;

/** Whether the box `box` covers the point `at`, within `SLACK`. */
function covers(box: { min: Vec3; max: Vec3 } | null, at: Vec3): boolean {
  return (
    box !== null &&
    at.x >= box.min.x - SLACK &&
    at.x <= box.max.x + SLACK &&
    at.y >= box.min.y - SLACK &&
    at.y <= box.max.y + SLACK &&
    at.z >= box.min.z - SLACK &&
    at.z <= box.max.z + SLACK
  );
}

/** The middle of a load's class box, hanging under its lift point. */
function middleOf(pose: { x: number; y: number; z: number }): Vec3 {
  return {
    x: pose.x,
    y: pose.y - LOAD_CLASS_DIMENSIONS[CLASS].y / 2,
    z: pose.z,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an attached load at the pose the run reports and not at its starting pose", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, CLASS, MASS, START, START);
  await poseTape(h, TAPE);
  await startRun(h);

  // The hook out in clear air, and the bob parked there so the pendulum is
  // still while the frame is read.
  await runUntil(
    h,
    (state) => state.run.stepIndex > 0 || state.run.phase !== "running",
    MAX_TICKS,
    "the tape's first step to complete, which puts the hook in clear air",
  );
  const pivot = (await h.snapshot()).run.pivot;
  await h.debug.setBob(pivot.x, pivot.y - HOIST_AT, pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.debug.setAxis("hoist", HOIST_AT);
  await h.advance(SETTLE);

  await h.debug.setLoadPhase(0, "attached");
  await h.advance(1);

  const state = await h.snapshot();
  assertEqual(
    state.run.loads[0]?.phase,
    "attached",
    "the phase the posed load holds, which this point is about " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    state.run.phase,
    "running",
    "the run the hanging load is read in, which must still be running for " +
      "the hanging pose to be the one drawn",
  );

  const boxes = (await drawnFromModel(h, MODEL)).map((one) =>
    drawnModelBox(one),
  );
  const onHook = middleOf(state.run.loads[0]!.pos);
  const atStart = middleOf(START);

  assertTrue(
    boxes.some((box) => covers(box, onHook)),
    "the crate model drawn over the class box of the load the run reports " +
      `hanging at (${onHook.x.toFixed(2)}, ${onHook.y.toFixed(2)}, ` +
      `${onHook.z.toFixed(2)}): the game draws "each load at its pose, ` +
      'waiting, hanging, or placed" (specs/assets.md). It is drawn at ' +
      JSON.stringify(boxes.map((box) => box?.centre)),
  );
  assertTrue(
    !boxes.some((box) => covers(box, atStart)),
    "no crate model left behind at the pose the load started from, " +
      `(${atStart.x.toFixed(2)}, ${atStart.y.toFixed(2)}, ` +
      `${atStart.z.toFixed(2)}): an attached load is drawn where it hangs ` +
      "(specs/assets.md)",
  );

  await h.capture("hanging", "The attached load hanging from the hook");
});
