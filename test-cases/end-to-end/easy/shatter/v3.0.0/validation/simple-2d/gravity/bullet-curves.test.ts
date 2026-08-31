// gravity/bullet-curves — the well bends one of the ship's bullets.
//
// `specs/gravity.md` lists "a bullet the ship fired" first among the pulled
// bodies, and `specs/weapons.md` says the same from the gun's side: a bullet is
// pulled by the well, wraps at the edges, and is removed when the core absorbs it
// or when it lands. This item decides that the pull actually reaches a shot in
// flight and bends it, and it decides nothing about how hard —
// `gravity/pull-magnitude` owns the law's strength and `gravity/pull-direction`
// its direction, each read off one tick where no tolerance can hide a wrong
// exponent. What is read HERE is the observable a player sees: where the shot
// ended up, against where an unbent one would have.
//
// THE SHOT, AND WHY IT IS THIS ONE. A bullet is posed on the line 150 units above
// the star's row, travelling along it at `MUZZLE_SPEED` (520) — the speed
// `specs/weapons.md` gives a shot from a ship at rest, so the flight is one the
// game really produces. The line is the review item's own figure, and it is
// chosen so the flight is decidable from end to end:
//
//   - THE SHOT NEVER REACHES THE CORE. Under the stated law its closest approach
//     over this flight is about 139 units, four times `CORE_R + BULLET_R` (33),
//     so `specs/collision.md`'s absorption never fires and the bullet is still in
//     flight to be read.
//   - AND IT NEVER OUTLIVES ITSELF. The reading is taken 1.25 seconds in, of the
//     `BULLET_LIFE` (1.5 s) that `specs/instrumentation.md` gives a posed bullet,
//     so a build that expires it on the specification's schedule still has it.
//   - AND NOTHING ELSE IS ON THE FIELD. `startPlaying` empties it and shuts both
//     world gates, and `specs/collision.md` gives a bullet and the ship no
//     interaction, so nothing but the well can touch the shot.
//
// WHAT IS COMPARED. The no-pull endpoint is arithmetic, not a second run: a body
// under no acceleration travels `velocity x time`, wrapped back into the field by
// `specs/field.md`'s rule. Under the stated law the bullet ends about 60 units
// from that point, half again the 40 the review item requires, so the margin
// absorbs a build that divides the flight into ticks slightly differently without
// letting through a build whose well is a tenth of the stated one.
//
// AND WHICH WAY IT BENT. A shot deflected 60 units in the WRONG direction would
// clear the item's distance while doing the opposite of what the well does, so
// the deviation ACROSS the shot's heading is read too, and it must fall on the
// star's side of the line. Which side that is comes out of the pose rather than
// being written down, so moving the shot cannot silently invert the check.
//
// AND THE CLIP DOES NOT CUT ON THE MEASUREMENT. The verdict is read at 1.25
// seconds, and the recording runs a fifth of a second past it — still inside
// `BULLET_LIFE` — so the reviewer sees the round carry on round the star rather
// than the frame the reading was taken on.

import { afterEach, beforeEach, it } from "vitest";
import { MUZZLE_SPEED, STAR_Y } from "../../src/constants";
import { assertGreaterThan } from "../assert";
import {
  bulletById,
  captureReplay,
  createHarness,
  poseBullet,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { STAR, distance, separation, wrap } from "../geometry";
import { add, componentAcross, scale, subtract, type Point } from "./law";

/** How far from the star's centre the shot's line passes: the item's figure. */
const MISS_DISTANCE = 150;

/** Where the shot starts: on that line, well to the left of the star's column. */
const START: Point = { x: 240, y: STAR_Y - MISS_DISTANCE };

/** The shot's velocity: straight along the line, at the gun's muzzle speed. */
const SHOT: Point = { x: MUZZLE_SPEED, y: 0 };

/** How far into the flight the reading is taken. Inside `BULLET_LIFE` (1.5 s). */
const FLIGHT_TICKS = ticksFor(1.25);

/** The ticks of flight the replay keeps after the reading, so it does not cut on it. */
const AFTERMATH_TICKS = ticksFor(0.2);

/** How far the shot must end from the unbent one, in units: the item's figure. */
const MIN_DEVIATION = 40;

/** Where a shot under no acceleration at all would have reached. */
const UNBENT: Point = wrap(add(START, scale(SHOT, secondsFor(FLIGHT_TICKS))));

/**
 * Which way across the shot's heading the star lies, as a sign.
 *
 * `componentAcross` measures across a heading signed a quarter-turn clockwise, so
 * this is `+1` when the star is clockwise of the shot and `-1` when it is
 * anticlockwise. Derived from the pose rather than written down, so moving the
 * shot cannot silently invert what "bent toward the star" means.
 */
const TOWARD_STAR = Math.sign(componentAcross(subtract(STAR, START), SHOT));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends a shot past the star well off the line an unbent shot would have held", async () => {
  startPlaying(h);
  const id = poseBullet(h, START.x, START.y, SHOT.x, SHOT.y);

  const snapshot = await captureReplay(h, "curve", async () => {
    await h.advance(FLIGHT_TICKS);
    const reading = h.snapshot();
    await h.advance(AFTERMATH_TICKS);
    return reading;
  });

  const bullet = bulletById(
    snapshot,
    id,
    `a bullet ${secondsFor(FLIGHT_TICKS)} seconds into a ` +
      `${MISS_DISTANCE}-unit pass of the star`,
  );
  const ended: Point = { x: bullet.x, y: bullet.y };
  const deviation = separation(UNBENT, ended);

  assertGreaterThan(
    distance(UNBENT, ended),
    MIN_DEVIATION,
    "units between where the shot ended and where an unpulled one would have " +
      "(specs/gravity.md: a bullet the ship fired is pulled)",
  );
  assertGreaterThan(
    componentAcross(deviation, SHOT) * TOWARD_STAR,
    0,
    "units the shot was deflected across its heading, signed toward the star",
  );
});
