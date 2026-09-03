// presentation/pad-footprint-marked — a load's pad is drawn as a footprint at
// the target position.
//
// specs/world.md § Pads: "A load's target pose is drawn as its pad: a marked
// footprint on the ground or on an obstacle's top, showing the class outline at
// the target yaw." specs/overview.md § Visual design puts the same requirement on
// the yard's legibility: "Anchor points, each load's starting position, and each
// pad's footprint and required yaw are marked so a site is readable before
// anything is built."
//
// THE SCENARIO MOVES THE PAD RATHER THAN REMOVING THE LOAD. What a build draws a
// pad AS is entirely its own — an outline, a hatched patch, a decal — so the
// reading has to be a before and after. Taking the load away would take its body
// off the screen at the same time, and then a change at the target could be the
// load's own drawing rather than the pad's. `setLoadTarget` moves ONLY the pad
// (specs/instrumentation.md: "Sets the target pose of the load at `index`, which
// is the pad it must be set down on"), so the load stands exactly where it stood,
// and the one thing that differs between the two frames is where the pad is.
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
// BOTH ENDS OF THE MOVE ARE READ. Something has to arrive on the ground where the
// pad now is, and something has to leave the ground where it was: a build that
// drew a footprint at a fixed place, or drew one everywhere, fails one half or
// the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
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

/** The one load, standing well clear of both pads. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 10, y: 2, z: 0, yaw: 0 };

/** The pad's two places: where it ends up, and where it starts. */
const TARGET: LoadPose = { x: 0, y: 2, z: 10, yaw: 0 };
const ELSEWHERE: LoadPose = { x: -8, y: 2, z: -6, yaw: 0 };

/**
 * How far off the ground a footprint may be bedded.
 *
 * A build lays its pad a hair over the floor so the two are not fighting for the
 * same pixels; a quarter of a unit is room for that and an eighth of
 * `LATTICE_PITCH`.
 */
const SLACK = 0.25;

/** A pad is a footprint ON THE GROUND, so it is read at ground level. */
function footOf(pose: LoadPose): Vec3 {
  return { x: pose.x, y: 0, z: pose.z };
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
  return drawnSignature(drawnOver(drawnObjects(h), at, SLACK));
}

it("marks the load's footprint on the ground at its target position", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await addOneLoad(h, CLASS, MASS, START, ELSEWHERE);
  await h.advance(1);

  const before = {
    target: over(footOf(TARGET)),
    elsewhere: over(footOf(ELSEWHERE)),
  };

  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, TARGET.yaw);
  await h.advance(1);
  await h.capture("pad", "The pad marked at the load's target position");

  const posed = await h.snapshot();
  assertEqual(
    JSON.stringify(posed.site.loads[0]?.to),
    JSON.stringify(TARGET),
    "the target the pose moved the pad to, which this point is about " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(posed.site.loads[0]?.from),
    JSON.stringify(START),
    "the load's own pose, which moving its pad leaves alone — so what parts " +
      "the two frames is the pad",
  );

  assertTrue(
    over(footOf(TARGET)) !== before.target,
    `the drawing on the ground at the pad's new target, (${TARGET.x}, ` +
      `${TARGET.z}), to change when the pad moves there: "A load's target ` +
      'pose is drawn as its pad: a marked footprint on the ground" ' +
      "(specs/world.md)",
  );
  assertTrue(
    over(footOf(ELSEWHERE)) !== before.elsewhere,
    `the drawing on the ground where the pad WAS, (${ELSEWHERE.x}, ` +
      `${ELSEWHERE.z}), to change when the pad moves away from it: the ` +
      "footprint is drawn at the target pose rather than everywhere " +
      "(specs/world.md)",
  );
});
