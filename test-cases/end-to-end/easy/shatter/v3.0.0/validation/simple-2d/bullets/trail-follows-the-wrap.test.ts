// bullets/trail-follows-the-wrap — the tail follows a round over a seam.
//
// specs/weapons.md, "The bullet trail", the last bullet: "Across a wrap it
// follows the bullet to the opposite edge rather than smearing across the field,
// so no drawn part of it is further from the bullet than `TRAIL_TICKS` of the
// bullet's travel by the shortest wrapped separation." That sentence is the
// verdict, read literally, in BOTH its directions: every column of the lane the
// round's drawing changed is held against the shortest wrapped distance
// `specs/field.md` defines, and the tail is read for ink on the far side of the
// seam it must have followed the round across.
//
// A CEILING ALONE DOES NOT DECIDE THIS ITEM. "No drawn part further than
// TRAIL_TICKS of travel" is a bound on SMEARING, and a build that simply truncates
// its tail at the seam — draws the near part and stops — satisfies it perfectly
// while doing the exact thing the item's name forbids. So the two halves are read
// separately: ink must stand on the far side of the seam, and nothing may stand
// beyond one tail's travel.
//
// WHY THE READING IS OVER EVERY DRAWN COLUMN AND NOT A SAMPLE. The fault this
// item exists to catch is a tail drawn as a straight line from where the round
// stood to where it now stands, across the whole field, because the two points
// sit either side of a seam. A build with that fault paints a thousand columns of
// the lane, and a check that looked only near the round would see the same
// picture a conforming build draws and pass it. So the band is walked end to end
// and the furthest changed column is what is asserted on.
//
// TWO THRESHOLDS, ONE FOR EACH HALF. The far-side reading is a claim that
// something was drawn, and a column counts once it moved by `LIT`, a floor any
// drawing clears. The ceiling is a claim that nothing was drawn anywhere else on
// the lane, and a build's empty field may twinkle or dither on its own, which is
// legal appearance that would otherwise read as a smear. So a column counts
// against the ceiling only past the band's own measured unrest (lane.ts,
// `absenceBound`), or past `LIT` where the band is still; a smear reads in the
// hundreds either way.
//
// THE POSE IS ARRANGED SO THE TAIL MUST STRADDLE THE SEAM. The round is placed
// `110` units short of the right edge and flown thirty ticks at `MUZZLE_SPEED`,
// which carries it `130` units: it crosses the edge and stands `20` units in from
// the left, with `78` units of tail owed behind it — so `58` of those units lie on
// the far side of the seam and there is no way to draw them without following the
// round across. The flight is longer than `TRAIL_TICKS` so the tail is full when
// it is read, and the crossing is confirmed before the verdict is taken, because
// a build that does not wrap at all has no seam for its tail to follow.
//
// THE ALLOWANCE ON THE SPAN is `20` units: the round's own disc of `BULLET_R`
// (`3`) at the head, the stroke width of a tail that is "widest and brightest
// where it meets the bullet", and the rounding of a logical unit onto a device
// column. It is a quarter of the span, and the fault it has to separate from a
// conforming tail is one that reads in the hundreds.
//
// THE LANE IS THE BOTTOM OF THE FIELD, `330` units below the star. Nothing of the
// star is drawn beyond `180` units (specs/field.md), the ship stands `130` units
// above the lane, and `startPlaying` leaves no rock and no saucer — and the
// control (lane.ts) is the same band with the round taken off the field, so
// whatever else the build paints on that band is painted in both and cannot read
// as tail.

import { afterEach, beforeEach, it } from "vitest";
import {
  BULLET_R,
  FIELD_W,
  MUZZLE_SPEED,
  TICK_DT,
  TRAIL_TICKS,
} from "../constants";
import {
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { createHarness, type Harness } from "../harness";
import { wrapX } from "../geometry";
import {
  absenceBound,
  furthestDrawn,
  litColumns,
  logicalX,
  trailLane,
} from "./lane";

/** The lane the round is flown along, and how deep the band read along it is. */
const LANE_Y = 690;
const LANE_HALF = 4;

/** The speed the gun itself gives a round. */
const SPEED = MUZZLE_SPEED;

/** How long the round is flown for: past the seam, and past a full tail. */
const FLIGHT_TICKS = 30;

/** The travel `specs/weapons.md` gives the tail: TRAIL_TICKS of the round's motion. */
const SPAN = SPEED * TRAIL_TICKS * TICK_DT;

/** Where the round starts, so that flight leaves it just past the right seam. */
const START_X = FIELD_W - SPEED * FLIGHT_TICKS * TICK_DT + 20;

/** How far a device column must move from the bare frame to count as drawn. */
const LIT = 5;

/** What may be drawn past the span: the head's own disc and the stroke that meets it. */
const SPAN_ALLOWANCE = 20;

/**
 * How far past the round, in units back along its travel, the far-side reading
 * begins: clear of the round's own disc, which reaches `BULLET_R` either way.
 */
const PAST_SEAM_MARGIN = 4;

/**
 * How far back along the travel that reading ends: half the tail's span.
 *
 * `specs/weapons.md` fades the tail out along its length, so its oldest end may be
 * all but invisible and a floor placed there would fail a conformant build. The
 * near half is the part a build has to have drawn whatever its fade.
 *
 * Everything in the band is on the FAR side of the seam because the check above
 * has already put the round within one tail's span of the left edge: measured back
 * along the travel, the field between the round and the seam runs out at
 * `round.x`, and the band starts past it.
 */
const BRIGHT_FRACTION = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the tail behind the round across the seam and nowhere else", async () => {
  // The trail carried across the seam behind the round.
  const reading = await trailLane(
    h,
    { y: LANE_Y, halfHeight: LANE_HALF },
    { x: START_X, speed: SPEED, ticks: FLIGHT_TICKS },
    "trail",
  );
  const { pair, round } = reading;
  const still = absenceBound(reading, LIT);

  assertLessThan(
    round.x,
    SPAN,
    `the round past the right seam and within one tail's length ` +
      `(${SPAN.toFixed(1)} units) of the left edge after ${FLIGHT_TICKS} ` +
      `ticks at ${SPEED} units per second from x = ${START_X.toFixed(1)}, so ` +
      `the tail it owes must cross the seam (specs/field.md: a body leaving ` +
      `the right edge re-enters at the left carrying its velocity)`,
  );

  // THE HALF OF THE ITEM A CEILING CANNOT DECIDE. A build that simply TRUNCATES
  // its tail at the seam — the defect "follows the wrap" names — paints nothing
  // across it, so every drawn column sits within a few units of the round and the
  // ceiling below passes it. This reads the far side directly: ink must stand
  // between the round's own column and half a tail's span back along its travel,
  // measured the way `specs/field.md` measures every separation, which on this
  // flight is across the right seam.
  const band = {
    from: round.x + PAST_SEAM_MARGIN,
    to: BRIGHT_FRACTION * SPAN,
  };
  const painted = litColumns(pair, LIT);
  const beyond = painted.filter((column) => {
    const behind = wrapX(round.x - logicalX(h, column));
    return behind >= band.from && behind <= band.to;
  });

  assertGreaterThan(
    beyond.length,
    0,
    `columns of the lane painted between ${band.from.toFixed(0)} and ` +
      `${band.to.toFixed(0)} units back along the round's travel — past the ` +
      `${round.x.toFixed(1)} units of field between the round and the left ` +
      `edge, so on the FAR side of the seam, and inside the bright half of ` +
      `the ${SPAN.toFixed(0)} units TRAIL_TICKS (${TRAIL_TICKS}) covers ` +
      `(specs/weapons.md: across a wrap the tail follows the bullet to the ` +
      `opposite edge rather than stopping at the seam); ` +
      `${painted.length} columns of the lane were painted at all`,
  );

  const furthest = furthestDrawn(h, pair, round.x, still);

  assertLessThanOrEqual(
    furthest.distance,
    SPAN + SPAN_ALLOWANCE,
    `no drawn part of the round's tail further than the ${SPAN.toFixed(1)} ` +
      `units of travel TRAIL_TICKS (${TRAIL_TICKS}) ticks cover at ${SPEED} ` +
      `units per second, by shortest wrapped separation, with ` +
      `${SPAN_ALLOWANCE} units of room for the round's own disc of BULLET_R ` +
      `(${BULLET_R}) and the stroke that meets it (specs/weapons.md: across a ` +
      `wrap the tail follows the bullet to the opposite edge rather than ` +
      `smearing across the field); a column counts as drawn past ` +
      `${still.toFixed(1)} of 441, the band's own idle unrest read ` +
      `${reading.spread.toFixed(1)}, and the furthest column the round's ` +
      `drawing changed was at x = ${furthest.x.toFixed(1)}, with the round at ` +
      `x = ${round.x.toFixed(1)}`,
  );
});
