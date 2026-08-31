// rocks/fragment-kick-is-perpendicular-to-the-shot — the fan lies across the SHOT.
//
// `specs/collision.md` states the direction and then, unusually, states what it is
// NOT: each fragment takes a kick "perpendicular to the bullet's travel at the
// moment it landed", and "the perpendicular is taken from the bullet's own
// direction of travel, not from the rock's course, so the fan lies across the shot
// whatever the rock was doing". The specification spells the confusion out because
// two builds this case has graded shipped it: they kick their fragments across the
// ROCK's course, which is the same thing only when the rock happens to be drifting
// along the line it was shot on.
//
// SO THE SCENARIO IS BUILT SO THE TWO CONVENTIONS CANNOT AGREE. The parent is posed
// at `FRAGMENT_FAN`'s (320, 620) drifting `(-60, -60)` — 85 units per second, a
// legal Large drift (`specs/rocks.md`) — and the fatal round is fired along `+x`.
// The rock's course and the bullet's travel are then 45 degrees apart, so:
//
//   perpendicular to the BULLET's travel   the fan's axis is VERTICAL
//   perpendicular to the ROCK's course     the fan's axis is 45 degrees off it
//
// and a build with the rule backwards reads a component along the shot of about
// 127 units per second against a bound of 30. The previous version of this case
// posed its parent where the two conventions nearly agreed, and caught those builds
// only by accident; that is fold-in fix C of `changelog.md`.
//
// THE ROUND DOES NOT CARRY THE ROCK'S DRIFT. Everywhere else in this suite a placed
// round carries its target's velocity so it cannot miss a drifting rock, but here
// the reading IS the bullet's direction of travel: a round carrying the parent's
// `(-60, -60)` would travel along the sum of the two and its perpendicular would be
// 7 degrees off vertical, which is a quarter of the bound spent on the harness's own
// convenience. Fired at `MUZZLE_SPEED` (520) against a rock closing at 60, the
// round crosses its four-unit standoff in under a hundredth of a second, in which
// the rock rises less than half a unit against a 49-unit contact radius, so nothing
// is risked by leaving the drift out.
//
// IT IS READ OFF THE PAIR. The DIFFERENCE between the two fragments' velocities is
// twice the kick with the parent's own motion — and everything the well added to
// it — cancelled exactly, so what is measured is the fan and nothing else.
//
// WHAT THIS DOES NOT DECIDE. How wide the fan opens, which is
// `rocks/fragment-kick-magnitude`'s; that the two fragments take opposite sides of
// it, which is `rocks/fragment-kick-opposite-sides`'s; and that they carry the
// parent's motion, which is `rocks/fragment-velocity-carries-the-parent`'s.

import { afterEach, beforeEach, it } from "vitest";
import { SPLIT_KICK } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import { FRAGMENT_FAN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  componentAlong,
  destroyByGun,
  fragmentPair,
  roundAlong,
  velocityDifference,
} from "./scenario";

/**
 * How far the fan may lean along the shot rather than across it, in units per
 * second, as the review item states: thirty.
 *
 * The difference of the pair is `2 x SPLIT_KICK` (180) whatever the parent was
 * doing, so 30 along the shot is a fan tilted about 9.6 degrees off the
 * perpendicular. It is room for a build's arithmetic and for the tick its round
 * landed on, and NOT for the environment: the parent's motion, well and all,
 * cancels in the difference. The wrong model it is set against — a kick across the
 * ROCK's course — reads 180 x sin(45 degrees), some 127 units per second, so
 * nothing rests on where between 30 and 127 the line falls.
 */
const TOLERANCE = 30;

/** Ticks of the fragments opening apart, recorded after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the fan across the bullet's travel rather than across the rock's course", async () => {
  startPlaying(h);
  const parentId = poseRock(
    h,
    "large",
    FRAGMENT_FAN.parent.x,
    FRAGMENT_FAN.parent.y,
    FRAGMENT_FAN.drift.vx,
    FRAGMENT_FAN.drift.vy,
  );

  // The recording runs on past the kill, so what a reviewer watches is the fan
  // opening and not the frame the measurement fell on.
  const kill = await captureReplay(h, "fan", async () => {
    const shot = await destroyByGun(h, parentId, (target) =>
      roundAlong(target, FRAGMENT_FAN.shotHeading, { carry: false }),
    );
    await h.advance(AFTERMATH_TICKS);
    return shot;
  });

  const [first, second] = fragmentPair(
    kill.at,
    "medium",
    "fragment-kick-is-perpendicular-to-the-shot",
  );
  const fan = velocityDifference(first, second);

  assertLessThanOrEqual(
    Math.abs(componentAlong(fan, FRAGMENT_FAN.shotHeading)),
    TOLERANCE,
    "units per second of the fan lying ALONG the round's travel rather than " +
      `across it — the fan is 2 x SPLIT_KICK (${2 * SPLIT_KICK}) wide and is ` +
      "taken perpendicular to the bullet's own direction, not to the rock's " +
      "course (specs/collision.md)",
  );
});
