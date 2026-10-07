// gravity/bullet-curves — the well bends one of the ship's bullets.
//
// `specs/gravity.md` lists "a bullet the ship fired" first among the pulled
// bodies, and `specs/weapons.md` says the same from the gun's side: "A bullet is
// pulled by the well, wraps at the edges, and is removed when it is absorbed by
// the star's core or when it lands." This item decides that the pull actually
// reaches a shot in flight and bends it, and it decides nothing about how hard —
// `gravity/pull-magnitude` owns the law's strength and `gravity/pull-direction`
// its direction, each read off one tick where no tolerance can hide a wrong
// exponent. What is read HERE is the observable a player sees: where the shot
// ended up against where an unbent one would have.
//
// THE SHOT, AND WHY IT IS THIS ONE. A bullet is posed on the line 150 units above
// the star's row, travelling along it at `MUZZLE_SPEED` (520) — the speed the gun
// gives a shot from a ship at rest, so the flight is one the game really produces.
// The line is the review item's own figure, and it is chosen so that the flight
// is decidable from end to end:
//
//   - THE SHOT NEVER REACHES THE CORE. Under the stated law the bullet's closest
//     approach over this flight is about 139 units, four times `CORE_R +
//     BULLET_R` (33), so `specs/collision.md`'s absorption never fires and the
//     bullet is still in flight to be read.
//   - AND IT NEVER OUTLIVES ITSELF. The flight is 1.25 seconds of the 1.5 that
//     `BULLET_LIFE` gives a bullet posed through `specs/instrumentation.md`, so a
//     build that expires it on the specification's schedule still has it.
//   - AND NOTHING ELSE IS ON THE FIELD. `startPlaying` leaves it empty and both
//     world gates shut, and `specs/collision.md` gives a bullet and the ship no
//     interaction, so nothing but the well can touch the shot.
//
// WHAT IS COMPARED. The no-pull endpoint is arithmetic, not a second run: a body
// under no acceleration travels `velocity x time`, wrapped back into the field by
// `specs/field.md`'s rule. Under the stated law the bullet ends about 60 units
// from that point, half again the 40 the review item requires, so the margin
// absorbs a build that divides the flight into ticks slightly differently without
// letting through a build whose well is a tenth of the stated one.
//
// AND WHICH WAY IT BENT. A shot deflected 60 units in the wrong direction would
// clear the item's distance while doing the opposite of what the well does, so
// the deviation ACROSS the shot's heading is read too, and it must be on the
// star's side of the line.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { MUZZLE_SPEED, STAR_X, STAR_Y } from "../constants";
import {
  captureReplay,
  createHarness,
  centreOf,
  poseBullet,
  requireBullet,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  add,
  componentAcross,
  scale,
  shortestDelta,
  subtract,
  wrap,
  wrappedDistance,
  type Vec,
} from "../geometry";

/** How far from the star's centre the shot's line passes: the item's figure. */
const MISS_DISTANCE = 150;

/** Where the shot starts: on that line, well to the left of the star's column. */
const START: Vec = { x: 240, y: STAR_Y - MISS_DISTANCE };

/** The shot's velocity: straight along the line at the gun's muzzle speed. */
const SHOT: Vec = { x: MUZZLE_SPEED, y: 0 };

/** How long the shot is followed. Inside `BULLET_LIFE` (1.5 s) with room to spare. */
const FLIGHT_TICKS = ticksFor(1.25);

/** How far the shot must end from the unbent one, in units: the item's figure. */
const MIN_DEVIATION = 40;

/** Where a shot under no acceleration at all would have reached. */
const UNBENT: Vec = wrap(add(START, scale(SHOT, secondsFor(FLIGHT_TICKS))));

/**
 * Which way across the shot's heading the star lies, as a sign.
 *
 * `componentAcross` measures across a heading signed clockwise, so this is `+1`
 * when the star is clockwise of the shot and `-1` when it is anticlockwise. It is
 * derived rather than written down so that moving the shot cannot silently invert
 * what "bent toward the star" means.
 */
const TOWARD_STAR = Math.sign(
  componentAcross(subtract({ x: STAR_X, y: STAR_Y }, START), SHOT),
);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("ends a shot past the star well off the line an unbent shot would have held", async () => {
  await startPlaying(harness);
  const id = await poseBullet(harness, START.x, START.y, SHOT.x, SHOT.y);

  const snapshot = await captureReplay(harness, "curve", async () => {
    await harness.advance(FLIGHT_TICKS);
    return harness.snapshot();
  });

  const bullet = requireBullet(
    snapshot,
    id,
    `a bullet ${secondsFor(FLIGHT_TICKS)} seconds into a ${MISS_DISTANCE}-unit pass`,
  );
  const deviation = shortestDelta(UNBENT, centreOf(bullet));

  assertGreaterThan(
    wrappedDistance(UNBENT, centreOf(bullet)),
    MIN_DEVIATION,
    "units between where the shot ended and where an unpulled one would have",
  );
  assertGreaterThan(
    componentAcross(deviation, SHOT) * TOWARD_STAR,
    0,
    "units the shot was deflected across its heading, toward the star",
  );
});
