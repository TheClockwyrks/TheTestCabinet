// assets/load-model-at-its-placed-pose — a placed load is drawn on its pad.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … and each load at its pose, waiting, hanging, or placed."
// specs/world.md § Loads: "A placed load sits at exactly its target pose for the
// rest of the run."
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
// AND IT IS GONE FROM WHERE IT STARTED, which is the other half of "at its pose":
// a build that drew a second crate at the starting pose, or never moved the one
// it had, would satisfy the first reading alone. The starting pose is put a long
// way from the pad so the two boxes cannot overlap.
//
// THE PHASE IS POSED RATHER THAN PLAYED TO. specs/instrumentation.md's
// `setLoadPhase` to `"placed"` "sits that load at its target pose", which is the
// precondition this point wants, and it reaches it without driving a whole
// delivery through the tape — a build with a broken attach must fail the attach's
// own points and pass this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_START,
  LOAD_CLASS_DIMENSIONS,
} from "../constants";
import {
  addOneLoad,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type LoadPose,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The one load: a crate that starts well clear of the crane and its pad. */
const CLASS = "crate" as const;
const MODEL = "models/crate.glb";
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

it("draws a placed load inside its class box at its target pose", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, CLASS, MASS, START, TARGET);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.debug.setLoadPhase(0, "placed");
  await h.advance(1);

  const state = await h.snapshot();
  assertEqual(
    state.run.loads[0]?.phase,
    "placed",
    "the phase the posed load holds, which this point is about " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    state.run.phase,
    "running",
    "the run the placed load is read in, which must still be running for the " +
      "placed pose to be the one drawn",
  );

  const boxes = (await drawnFromModel(h, MODEL)).map((one) =>
    drawnModelBox(one),
  );
  const onPad = middleOf(state.run.loads[0]!.pos);
  const atStart = middleOf(START);

  assertTrue(
    boxes.some((box) => covers(box, onPad)),
    "the crate model drawn over the placed load's class box on its pad, " +
      `centered on (${onPad.x.toFixed(2)}, ${onPad.y.toFixed(2)}, ` +
      `${onPad.z.toFixed(2)}): "A placed load sits at exactly its target ` +
      'pose" (specs/world.md) and the game draws "each load at its pose" ' +
      `(specs/assets.md). It is drawn at ${JSON.stringify(
        boxes.map((box) => box?.centre),
      )}`,
  );
  assertTrue(
    !boxes.some((box) => covers(box, atStart)),
    "no crate model left behind at the pose the load started from, " +
      `(${atStart.x.toFixed(2)}, ${atStart.y.toFixed(2)}, ` +
      `${atStart.z.toFixed(2)}): the load is drawn at its pose, and a placed ` +
      "load's pose is its target (specs/assets.md, specs/world.md)",
  );

  await h.capture("placed", "The placed load on its pad");
});
