// Shatter — saucer/avoids-the-core: no crossing ever brings the saucer's circle
// over the star's core.
//
// THE RULE. `specs/saucer.md`: "It is a powered craft. The well never pulls it, and
// it steers clear of the star's core: at no moment does the saucer's circle overlap
// the core, so its centre is never closer to `(STAR_X, STAR_Y)` than
// `CORE_R + SAUCER_R` (`48`). HOW FAR OUTSIDE THAT IT CHOOSES TO STEER IS THE
// BUILD'S OWN." The one distance the specification fixes is therefore the only one
// this item may assert, and everything about the approach is left to the build.
//
// THIRTY-SIX REAL CROSSINGS, NOT ONE POSED CONFRONTATION. A scenario that lines a
// saucer up sixty units from the star at cruise gives it under half a second of
// warning, and a craft that answers with vertical speed while keeping its
// crossing speed still clips the core — so such a check passes exactly one way of
// steering and fails conformant builds for the way they steer. What is flown here
// instead is the entry rule's own output: nine rows from eighty units below the
// star's to eighty above it, each from the left edge and from the right, the whole
// set with each weave direction. Every one of them is a course the game itself
// produces, and the whole approach is the build's to steer.
//
// AND THE VERDICT IS THE WORST OF ALL THIRTY-SIX, because avoidance is often
// one-sided — which the rows either side of the star are for — and because a build
// that rerolls its weave on a timer can have a reroll discard the avoidance it had
// accumulated. Both weave directions, posed through `setSaucerWeave`, because
// `specs/saucer.md` draws the direction of the first reroll at random and a saucer
// weaving into the star is a different crossing from one weaving away.
//
// THE DISTANCE IS MEASURED TO THE LINE BETWEEN SAMPLES. Reading the samples alone
// at this stride reports the saucer further out than it got, because the closest
// point of its path lies between two of them — which is the wrong direction for a
// check hunting a build that came too close. `closestApproach` in `geometry.ts` is
// that reading.
//
// THE GUN IS OFF, so fifty-four crossings put no round on the field at all. Its
// mind is on, because the steering IS the requirement.
//
// THE SAMPLING RUNS INSIDE THE PAGE, for the reason `cadence.ts` sets out beside
// `traceSaucerPath`: thirty-six crossings are tens of thousands of ticks and read
// two numbers off each sample, and a round trip apiece would make this item's
// verdict a fact about how loaded the host was. The loop there calls the build's
// own `advance` and the build's own `snapshot()`, and the crossing it follows is
// the build's own.
//
// THE RECORDING IS THE CLOSEST CROSSING, NOT THE FIRST. On a failing build the
// dead-on approach is frequently one it handles cleanly, so filming the first would
// read as a false positive to anyone watching the playback. The sweep keeps the
// row, the edge and the weave of the worst approach, and the recorder is then
// armed over that crossing flown again.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  FIELD_W,
  SAUCER_CLEARANCE,
  SAUCER_LIFETIME,
  SAUCER_R,
  SAUCER_SPEED,
  STAR_X,
  STAR_Y,
} from "../constants";
import { closestApproach, shortestAxis, type Vec } from "../geometry";
import {
  captureReplay,
  createHarness,
  poseSaucer,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";
import { traceSaucerPath } from "./cadence";

/** The nine entry rows: eighty units either side of the star's, in twenties. */
const ROW_OFFSETS = [-80, -60, -40, -20, 0, 20, 40, 60, 80] as const;

/** The two edges a saucer enters at, each heading into the field. */
const EDGES = [
  { name: "left", x: SAUCER_R, vx: SAUCER_SPEED },
  { name: "right", x: FIELD_W - SAUCER_R, vx: -SAUCER_SPEED },
] as const;

/** The two weave directions the whole set is flown with: down, and up. */
const WEAVES = [1, -1] as const;

/**
 * How near the star's column a crossing is sampled at all: `320` units.
 *
 * Geometry, not a bound. Outside this the saucer's centre is at least `320` units
 * from the star's whatever its row, against the `48` the item asserts, so nothing
 * outside the window can be the closest approach and the ground it covers getting
 * there is skipped in one call.
 */
const WINDOW = 320;

/**
 * The eight ticks between two samples inside the window.
 *
 * A fifteenth of a second, over which a saucer travelling at its cruise and weaving
 * at full vertical speed covers `11.1` units. That is what makes fifty-four
 * crossings affordable, and it is why the distance is read to the LINE between
 * samples rather than to the samples themselves.
 */
const SAMPLE_STRIDE = 8;

/**
 * How far a chord may cut inside the path it spans: `0.4` units.
 *
 * Derived, not chosen. A saucer holding the bound exactly would be travelling a
 * circle of radius `SAUCER_CLEARANCE` around the star, and the straight line
 * between two samples `11.1` units apart on that circle passes
 * `48 - sqrt(48^2 - 5.55^2)` = `0.32` units inside it. So a build that really did
 * hold `48` would be read at `47.68`, and this allowance is what stops the sweep's
 * own stride from failing it. It is 0.8 percent of the bound, and it corrects a
 * bias this check introduced rather than widening the rule.
 */
const CHORD_ALLOWANCE = 0.4;

/** The stride the ground before the window is covered in. Nothing is read there. */
const APPROACH_STRIDE = 60;

/**
 * How long one crossing may run before the sweep gives up on it.
 *
 * `SAUCER_LIFETIME` is the ceiling the specification itself puts on a visit, so a
 * crossing that has not reached the far side of the window inside it has left the
 * field on its own clock and there is nothing further to sample.
 */
const CROSSING_CEILING = ticksFor(SAUCER_LIFETIME);

/** The ticks one pass through the window takes at the cruise, with room to spare. */
const WINDOW_TICKS = ticksFor((2 * WINDOW) / SAUCER_SPEED) + ticksFor(0.5);

/** A second of the crossing after the window, so the recording ends on the outcome. */
const TAIL_TICKS = ticksFor(1);

/** One crossing of the thirty-six: which row, which edge, which weave. */
interface Crossing {
  weave: (typeof WEAVES)[number];
  row: number;
  edge: (typeof EDGES)[number];
}

/** How near the star's column a saucer stands, across the seam. */
function columnGap(snapshot: ShatterSnapshot): number {
  const saucer = snapshot.saucer;
  if (saucer === null || saucer === undefined) return Number.POSITIVE_INFINITY;
  return Math.abs(shortestAxis(saucer.x, STAR_X, FIELD_W));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose one crossing on a fresh, quiet field.
 *
 * EACH CROSSING IS POSED IN ITS OWN RIGHT, from the three things that name it — the
 * row, the edge and the weave — so the recording at the end is the crossing the
 * verdict rests on rather than one that merely began the same way. `setSaucerWeave`
 * poses the direction `specs/saucer.md` draws for the first weave reroll, and
 * `startPlaying` empties the field, shuts both world gates and switches the ship's
 * contact test off.
 */
async function poseCrossing(crossing: Crossing): Promise<void> {
  await h.debug.reset();
  await startPlaying(h);
  await poseSaucer(h, crossing.edge.x, crossing.row, {
    vx: crossing.edge.vx,
    vy: 0,
    mind: true,
    gun: false,
  });
  await h.debug.setSaucerWeave(crossing.weave);
}

it("keeps every one of 36 crossings clear of CORE_R + SAUCER_R", async () => {
  const crossings: Crossing[] = [];
  for (const weave of WEAVES) {
    for (const edge of EDGES) {
      for (const offset of ROW_OFFSETS) {
        crossings.push({ weave, row: STAR_Y + offset, edge });
      }
    }
  }

  const star: Vec = { x: STAR_X, y: STAR_Y };
  let worst = Number.POSITIVE_INFINITY;
  let worstCrossing = crossings[0];

  for (const crossing of crossings) {
    await poseCrossing(crossing);

    const path = await traceSaucerPath(h, {
      stride: SAMPLE_STRIDE,
      approach: APPROACH_STRIDE,
      window: WINDOW,
      maxTicks: CROSSING_CEILING,
      fieldWidth: FIELD_W,
      starX: STAR_X,
    });

    const closest = closestApproach(path, star);
    if (closest < worst) {
      worst = closest;
      worstCrossing = crossing;
    }
  }

  await poseCrossing(worstCrossing);
  await h.skipUntil((snapshot) => columnGap(snapshot) <= WINDOW, {
    poll: APPROACH_STRIDE,
    maxTicks: CROSSING_CEILING,
  });
  await captureReplay(h, "closest", async () => {
    await h.advance(WINDOW_TICKS + TAIL_TICKS);
  });

  assertGreaterThan(
    worst,
    SAUCER_CLEARANCE - CHORD_ALLOWANCE,
    `how near the star's centre the closest of 36 crossings came — row ${worstCrossing.row}, from the ${worstCrossing.edge.name}, weaving ${worstCrossing.weave > 0 ? "down" : "up"} first (specs/saucer.md)`,
  );
});
