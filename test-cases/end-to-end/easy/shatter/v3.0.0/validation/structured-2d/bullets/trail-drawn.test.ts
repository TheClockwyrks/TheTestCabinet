// bullets/trail-drawn — a moving round has a tail drawn behind it.
//
// specs/weapons.md, "The bullet trail": "Behind every moving bullet a fading tail
// traces its recent path", and it "spans a fixed slice of recent travel, the last
// `TRAIL_TICKS` (`18`) ticks of the bullet's motion". This item decides the
// existence of that tail and the one thing about it that is not a matter of
// degree: WHICH SIDE OF THE ROUND IT IS ON. How it behaves at a seam is
// `bullets/trail-follows-the-wrap`'s item; how long it looks for a given speed is
// the picture the reviewer judges.
//
// WHAT IS READ. A round is flown along an empty lane at `MUZZLE_SPEED` for long
// enough to have a full `TRAIL_TICKS` of history behind it, and the band of
// device rows along that lane is compared against the same band of the same
// empty game flown without the round (lane.ts sets out why the control is a
// second flight rather than a second reading). Two numbers come out: how far the
// changed columns run BACK from the round along its travel, and how far they run
// FORWARD.
//
// THE TWO BOUNDS, AND WHAT EACH RULES OUT.
//
// - BEHIND, at least `TRAIL_MINIMUM` of the span the specification fixes. A build
//   that draws no tail reads `0`. The bound is a third of the span rather than
//   the whole of it because the specification has the tail "fading to nothing at
//   its oldest end": its drawn extent is allowed to fall short of its geometric
//   one, and by how much is the build's own styling. A third is far below any
//   fade a legible tail can have and far above nothing at all.
// - AHEAD, at most `HEAD_ALLOWANCE`. Something is always drawn at the head — the
//   round itself is a disc of `BULLET_R` (`3`), and a tail "widest and brightest
//   where it meets the bullet" is drawn with a stroke that reaches a little past
//   it. `20` units is six of those radii and a quarter of the span, so a head is
//   comfortably inside it and a build that draws its streak symmetrically about
//   the round, or on the wrong side, reads the whole span and fails.
//
// THE LANE IS THE BOTTOM OF THE FIELD, `330` units below the star. Nothing of the
// star is drawn beyond `1.5 x HALO_R` (`180`) (specs/field.md), so no part of it
// reaches the band; the ship stands at the safe point `130` units above it and
// `startPlaying` leaves no rock and no saucer. The well still pulls the round
// (specs/gravity.md), by about a unit of `y` over this flight, which is why the
// band is read four units either side of the lane rather than on one row.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R, MUZZLE_SPEED, TICK_DT, TRAIL_TICKS } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachAlong, trailLane, type ReachOptions } from "./lane";

/** The lane the round is flown along, and how deep the band read along it is. */
const LANE_Y = 690;
const LANE_HALF = 4;

/** Where the round starts, and the speed the gun itself gives one. */
const START_X = 300;
const SPEED = MUZZLE_SPEED;

/** Long enough that the round has a full TRAIL_TICKS of travel behind it. */
const FLIGHT_TICKS = TRAIL_TICKS + 4;

/** The travel `specs/weapons.md` gives the tail: TRAIL_TICKS of the round's motion. */
const SPAN = SPEED * TRAIL_TICKS * TICK_DT;

/**
 * How far a device column must move from the bare frame to count as drawn.
 *
 * `5` on the `0`-to-`441.67` scale of the RGB distance, about one percent. The
 * specification fixes no palette, so the only thing a reading can require is that
 * the pixel is measurably not what it was; this is barely above the rounding of
 * an 8-bit channel and far below anything a legible tail draws.
 */
const LIT = 5;

/**
 * The widest unlit run a streak may contain and still be one streak, in units.
 *
 * A tail drawn sample by sample puts its samples one tick of travel apart, which
 * at the muzzle speed is `4.3` units, and a fade crossing the threshold for a
 * sample or two leaves a hole of about that size. Twelve units is nearly three of
 * them, and it is a sixth of the span, so it cannot manufacture a reach.
 */
const GAP = 12;

/** Where a reading of the streak starts, clear of the round's own disc. */
const FROM = BULLET_R + 3;

/** The least of the span the drawn tail must reach back: a third. */
const TRAIL_MINIMUM = SPAN / 3;

/** The most that may be drawn AHEAD of the round: over six times BULLET_R. */
const HEAD_ALLOWANCE = 20;

const WALK: ReachOptions = { from: FROM, to: SPAN, threshold: LIT, gap: GAP };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a streak behind a moving round and not ahead of it", async () => {
  const { pair, round, map } = await trailLane(
    h,
    { y: LANE_Y, halfHeight: LANE_HALF },
    { x: START_X, speed: SPEED, ticks: FLIGHT_TICKS },
  );
  // The tail drawn behind a moving round.
  captureStill(h, "trail");

  const behind = reachAlong(map, pair, round.x, -1, WALK);
  const ahead = reachAlong(map, pair, round.x, 1, WALK);

  assertGreaterThanOrEqual(
    behind,
    TRAIL_MINIMUM,
    `the drawn streak reaching back at least ${TRAIL_MINIMUM.toFixed(1)} ` +
      `units behind a round travelling at ${SPEED} units per second — a third ` +
      `of the ${SPAN.toFixed(1)} units of travel TRAIL_TICKS (${TRAIL_TICKS}) ` +
      `ticks cover at that speed (specs/weapons.md); measured as the run of ` +
      `columns this flight changed against the same flight without the round`,
  );
  assertLessThanOrEqual(
    ahead,
    HEAD_ALLOWANCE,
    `nothing drawn more than ${HEAD_ALLOWANCE} units AHEAD of the round along ` +
      `its travel — over six times BULLET_R (${BULLET_R}), which is room for ` +
      `the round's own disc and the stroke that meets it (specs/weapons.md: the ` +
      `tail is BEHIND the bullet); the streak behind it read ` +
      `${behind.toFixed(1)} units`,
  );
});
