// rocks/fragment-kick-opposite-sides — the two fragments are thrown opposite ways.
//
// `specs/collision.md` gives each fragment "a kick of `SPLIT_KICK` (`90`)
// perpendicular to the bullet's travel [...], the two fragments kicked to opposite
// sides". This item decides the last clause: the pair opens SYMMETRICALLY about the
// motion the parent handed on, so one fragment goes one way and the other goes back
// the other way. A build that kicks both fragments to the same side has a split
// that shoves the whole pair sideways off the parent's course; a build that kicks
// one and leaves the other has a split that drops half a rock where the parent was.
//
// EACH KICK IS MEASURED AGAINST THE PARENT'S OWN VELOCITY, read from the snapshot on
// the tick before the fatal round landed, which is exactly what
// `specs/collision.md` says a fragment's velocity is built from. Measuring each
// against the AVERAGE of the two instead would decide nothing at all: the average
// of two vectors is by construction equidistant from both, so the two deviations
// from it are identically opposite on EVERY build, conformant or not, and the check
// would pass a build that threw both fragments the same way. Against the parent the
// claim has content, and on a conformant build the two readings coincide, since the
// average IS the parent's velocity.
//
// THE PLACEMENT IS `FRAGMENT_FAN` (`fixtures.ts`), the arrangement all four fan
// items share: a Large 412 units out from the star drifting at a legal 85 units per
// second, taken by a round fired along `+x`. It matters here for the same reason as
// there — a parent at rest would make "opposite about the parent" and "opposite
// about the origin" the same claim, and a drifting one tells them apart.
//
// THE KICKS ARE ASSERTED SUBSTANTIAL BEFORE THEIR DIRECTIONS ARE COMPARED. The
// angle between two vectors is meaningless when either is a rounding error, so a
// build whose fragments simply inherit the parent and go nowhere fails here naming
// the kick rather than passing on the arithmetic of two zero vectors. The floor is a
// fraction of `SPLIT_KICK` and is not the figure itself: how big the kick is is
// `rocks/fragment-kick-magnitude`'s point, and this item must not fail twice for one
// defect.
//
// WHAT THIS DOES NOT DECIDE. Which way the fan's axis lies, which is
// `rocks/fragment-kick-is-perpendicular-to-the-shot`'s; how wide it opens, which is
// `rocks/fragment-kick-magnitude`'s; and that the pair carries the parent's motion,
// which is `rocks/fragment-velocity-carries-the-parent`'s.

import { afterEach, beforeEach, it } from "vitest";
import { SPLIT_KICK } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { FRAGMENT_FAN } from "../fixtures";
import { DEG, angleBetween, headingOf } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { destroyByGun, fragmentPair, lengthOf, roundAlong } from "./scenario";

/**
 * How far from opposite the two kicks may lie, in degrees, as the review item
 * states: five.
 *
 * Room for a build's own arithmetic and for the tick its round landed on. The well
 * enters only through the parent being read one tick before the kill, which at this
 * placement moves its velocity by a fifth of a unit per second against kicks of 90 —
 * about a seventh of a degree. The wrong model the bound is set against, both
 * fragments kicked the same way, reads 0 degrees apart rather than 180.
 */
const TOLERANCE_DEGREES = 5;

/**
 * How small a kick may be before its DIRECTION is no longer a meaningful thing to
 * measure: a tenth of `SPLIT_KICK`.
 *
 * A guard on the scenario rather than a grading of the figure — `rocks/fragment-
 * kick-magnitude` is where 90 is graded, to a tenth. Nine units per second is far
 * below anything that item would accept and far above the fifth of a unit per
 * second the well contributes, so no build fails both for one defect and none
 * passes this on two vectors of noise.
 */
const MEANINGFUL_KICK = SPLIT_KICK * 0.1;

/** Ticks of the fragments opening apart, run after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("kicks one fragment each way about the velocity the parent handed on", async () => {
  startPlaying(h);
  const parentId = poseRock(
    h,
    "large",
    FRAGMENT_FAN.parent.x,
    FRAGMENT_FAN.parent.y,
    FRAGMENT_FAN.drift.vx,
    FRAGMENT_FAN.drift.vy,
  );

  const kill = await destroyByGun(h, parentId, (target) =>
    roundAlong(target, FRAGMENT_FAN.shotHeading, { carry: false }),
  );

  const parent = requireRock(
    kill.before,
    parentId,
    "the Large on the tick before the fatal round landed",
  );
  const [first, second] = fragmentPair(
    kill.at,
    "medium",
    "fragment-kick-opposite-sides",
  );

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "fan");

  const kicks = [first, second].map((fragment) => ({
    x: fragment.vx - parent.vx,
    y: fragment.vy - parent.vy,
  }));

  for (const [index, kick] of kicks.entries()) {
    assertGreaterThan(
      lengthOf(kick),
      MEANINGFUL_KICK,
      `fragment ${index + 1}: units per second of kick away from the parent's ` +
        "own velocity, before the two kicks' directions are compared " +
        "(specs/collision.md)",
    );
  }

  const apart = angleBetween(
    headingOf({ vx: kicks[0].x, vy: kicks[0].y }),
    headingOf({ vx: kicks[1].x, vy: kicks[1].y }),
  );

  assertLessThanOrEqual(
    Math.abs(180 - apart / DEG),
    TOLERANCE_DEGREES,
    "degrees from opposite the two fragments' kicks lie — each is the " +
      "parent's velocity plus a kick, and the two are kicked to opposite " +
      "sides (specs/collision.md)",
  );
});
