// presentation/load-starts-marked — each load is drawn where the site starts it.
//
// specs/overview.md § Visual design, the row for anchors and pads: "Anchor
// points, each load's starting position, and each pad's footprint and required
// yaw are marked so a site is readable before anything is built." specs/ui.md
// § Build has the build screen show "each load at its starting pose with its
// pad", and specs/world.md fixes what a load occupies: "Every load pose in this
// specification is the pose of the load's lift point: the center of its top
// face... The load's box extends half its width and half its depth horizontally
// from the lift point, rotated by its yaw, and its full height below it."
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills and every one of its vertices, in world units.
// `engine/rendering.md` fixes that the pipeline collects every enabled, visible
// render component on every live actor and draws it, so any build of this case
// that puts something on screen puts it there. `drawnOver` narrows that to what
// stands over one place, and `drawnSignature` turns it into a value two frames
// can be compared by.
//
// NOTHING IS FOUND BY NAME, AND NO COLOUR IS ASSERTED. What a build calls an
// object, which component it reaches for and what it paints with are the
// build's; what a check holds it to is that the drawing over one place changed
// when the game did, and that the drawing elsewhere did not.
//
// THE READING IS A BEFORE AND AFTER OVER THE BOX, so that what is found is the
// load's own drawing rather than something the yard already carried: the yard is
// emptied, the drawing over the middle of the class box is read, one load is
// added at a known starting pose, and it is read again.
//
// AND A PLACE THE LOAD IS NOT IS READ BESIDE IT — a patch of yard clear of both
// the load's starting pose and the pad it is wanted on — so a build that redrew
// the whole yard on every edit could not pass by accident. That the PAD is marked
// is its own point, next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  drawnObjects,
  drawnOver,
  drawnSignature,
  openSite,
  type Harness,
  type LoadPose,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The one load, its starting pose, and the pad it is wanted on. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 8, y: 2, z: -4, yaw: 0 };
const TARGET: LoadPose = { x: -6, y: 2, z: 6, yaw: 0 };

/** A patch of yard clear of both, which adding the load may not change. */
const ELSEWHERE: Vec3 = { x: 8, y: 1, z: 4 };

/** The middle of a load's class box, hanging under its lift point. */
function middleOf(pose: LoadPose): Vec3 {
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

/** What the yard draws over `at` right now. */
function over(at: Vec3): string {
  return drawnSignature(drawnOver(drawnObjects(h), at));
}

it("draws a waiting load at the starting pose the site gives it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const empty = await h.snapshot();
  assertEqual(empty.screen, "build", "the screen opening a site shows");
  assertEqual(
    empty.site.loads.length,
    0,
    "the loads standing in the emptied yard, before the one this point adds",
  );
  const bareStart = over(middleOf(START));
  const bareElsewhere = over(ELSEWHERE);

  await addOneLoad(h, CLASS, MASS, START, TARGET);
  await h.advance(1);
  await h.capture("loads", "The waiting load at the pose the site starts it");

  const posed = await h.snapshot();
  assertEqual(
    JSON.stringify(posed.site.loads[0]?.from),
    JSON.stringify(START),
    "the starting pose the site gives the load this point reads " +
      "(specs/instrumentation.md)",
  );

  assertTrue(
    over(middleOf(START)) !== bareStart,
    "the drawing over the load's own class box at its starting pose, " +
      `(${START.x}, ${START.y}, ${START.z}), to change when the site starts a ` +
      'load there: the build screen shows "each load at its starting pose" ' +
      "(specs/ui.md) and a load's starting position is marked " +
      "(specs/overview.md)",
  );
  assertEqual(
    over(ELSEWHERE),
    bareElsewhere,
    `the drawing over the patch of yard at (${ELSEWHERE.x}, ${ELSEWHERE.y}, ` +
      `${ELSEWHERE.z}), which carries neither the load nor its pad and which ` +
      "starting a load elsewhere may not change",
  );
});
