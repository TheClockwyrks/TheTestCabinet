// presentation/pad-on-an-obstacle-top — a pad whose target stands on an
// obstacle's top face is drawn up there, not down on the ground.
//
// `specs/world.md` puts a load's pad at its target pose, and a target's `y` is
// part of that pose — so a pad wanted on a shelf is a pad up on the shelf.
// `specs/overview.md` asks that "each pad's footprint and required yaw are marked
// so a site is readable before anything is built", and a site whose shelf pad was
// drawn on the floor would be read wrong before a single member went in.
//
// THE TARGET IS THE POSE A CRATE RESTING ON THE SHELF ACTUALLY HAS. `specs/world.md`
// § Loads: "Every load pose in this specification is the pose of the load's lift
// point: the center of its top face. A load resting on the ground therefore has
// its lift point at `y` equal to its class height, and one resting on an
// obstacle's top at that top's height PLUS ITS CLASS HEIGHT." So a crate on a
// three-high shelf is targeted at `y` five, and a target of three would be a
// crate sunk two units into the shelf — a scenario this point is not about.
//
// THE READING IS WHICH SURFACE THE PAD SITS ON, which is what the point is named
// for and all `specs/instrumentation.md` fixes about a mark standing for a load
// pose: "carries that pose's `x` and `z`, and a `y` anywhere between the surface
// the load rests on and the lift point above it", because the marking is drawn on
// the surface while the pose it names is the lift point and a build may report
// either. So the pad is required to be up on the shelf's top face and no higher
// than the crate that rests there.
//
// AND THAT SAME LATITUDE IS WHAT THE BAND'S FLOOR HAS TO CLEAR. A pad drawn down
// on the GROUND is not reported at nought under it: the ground is the surface and
// the lift point above it is the class height, so a build reporting the lift
// point puts a ground pad at `2` — one unit under the shelf's top face rather
// than three. The floor below is placed between those two heights and nowhere
// near the ground, and that ONE UNIT is the whole of the margin this point
// decides on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
  addOneObstacle,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

const CLASS = "crate" as const;
const FROM = { x: 7, y: 0, z: -3, yaw: 0 };

/** A shelf, and the pad wanted on its top face. */
const SHELF_MIN = { x: -7, y: 0, z: 7 };
const SHELF_SIZE = { x: 4, y: 3, z: 4 };
const SHELF_TOP = SHELF_MIN.y + SHELF_SIZE.y;
const TARGET = {
  x: -5,
  y: SHELF_TOP + LOAD_CLASS_DIMENSIONS[CLASS].y,
  z: 9,
  yaw: 0,
};

/**
 * The lowest `y` a pad on the shelf's top face may be reported at.
 *
 * HALFWAY BETWEEN THE TWO HEIGHTS IT HAS TO TELL APART, which are the shelf's
 * top face (`3`) and the highest a pad on the GROUND could be reported at, which
 * is the lift point of a crate resting there and so the class height (`2`) — not
 * the ground itself. A build that draws the marking on the face it belongs to and
 * one that draws it on the wrong face are each half a unit the right side of
 * this, which is also all the slack there is: a floor pushed down as far as `2`
 * would stop this point measuring the fault it is named for. It is derived from
 * the fixture rather than written down, so a taller shelf or a taller class moves
 * it rather than quietly closing the gap.
 */
const FLOOR = (SHELF_TOP + LOAD_CLASS_DIMENSIONS[CLASS].y) / 2;

/**
 * How far ABOVE the lift point a pad may still be reported, in world units.
 *
 * Generous against the sliver a build lifts a marking by to keep it off the face
 * it is drawn on, and nothing rests on it: the fault this point is named for is
 * on the other side of the band.
 */
const LIFT_SLIVER = 0.75;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a pad wanted on an obstacle's top at that height", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("build");
  await addOneObstacle(h, SHELF_MIN, SHELF_SIZE);
  await addOneLoad(h, CLASS, 40, FROM, TARGET);
  await h.advance(1);

  const pads = entriesOf(await h.drawn(), "mark", "pad");

  await h.capture("shelf-pad", "The pad marked on the obstacle's top face");

  assertTrue(pads.length > 0, "a pad mark among what the frame drew");
  assertGreaterThanOrEqual(
    pads[0]!.y,
    FLOOR,
    `the pad drawn on the obstacle's top face (${SHELF_TOP}) rather than on ` +
      `the ground, whose own pad would be reported no higher than ` +
      `${LOAD_CLASS_DIMENSIONS[CLASS].y} ` +
      "(specs/world.md, specs/instrumentation.md)",
  );
  assertLessThanOrEqual(
    pads[0]!.y,
    TARGET.y + LIFT_SLIVER,
    "the pad drawn no higher than the lift point of a load resting on that " +
      `face (${TARGET.y}) (specs/world.md, specs/instrumentation.md)`,
  );
});
