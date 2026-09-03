// assets/load-model-at-its-waiting-pose — a waiting load is drawn where the site
// starts it.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … and each load at its pose, waiting, hanging, or placed."
// specs/world.md § Loads: "Every load pose in this specification is the pose of
// the load's lift point: the center of its top face."
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
// THE WORLD IS ONE LOAD AND NOTHING ELSE: `clearAll` empties the yard of every
// structure, obstacle and load, and exactly one crate is added at a known
// starting pose. So the only thing in the yard a crate model could belong to is
// that load.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  openSite,
  type Harness,
  type LoadPose,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The one load: a crate, and the file specs/assets.md names for that class. */
const CLASS = "crate" as const;
const MODEL = "models/crate.glb";
const MASS = 40;

/** Where it waits: clear of the site's anchors, well inside the envelope. */
const START: LoadPose = { x: 7, y: 2, z: -3, yaw: 0 };

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

it("draws a waiting load inside its class box at its starting pose", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await addOneLoad(h, CLASS, MASS, START, START);
  await h.advance(1);

  const state = await h.snapshot();
  assertEqual(
    state.site.loads.length,
    1,
    "the loads the emptied yard holds: the one this point is about " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    state.run.phase,
    "idle",
    "the run the load waits in — a load is waiting before a run starts " +
      "(specs/world.md)",
  );

  const boxes = (await drawnFromModel(h, MODEL)).map((one) =>
    drawnModelBox(one),
  );
  // The pose the SITE starts the load at, which is the build's own reading of
  // it rather than the figure this file asked for.
  const middle = middleOf(state.site.loads[0]!.from);
  assertTrue(
    boxes.some((box) => covers(box, middle)),
    "the crate model drawn over the waiting load's own class box, centered " +
      `on (${middle.x.toFixed(2)}, ${middle.y.toFixed(2)}, ` +
      `${middle.z.toFixed(2)}): the game draws "each load at its pose, ` +
      'waiting, hanging, or placed" (specs/assets.md). It is drawn at ' +
      JSON.stringify(boxes.map((box) => box?.centre)),
  );

  await h.capture("waiting", "The waiting load at its starting pose");
});
