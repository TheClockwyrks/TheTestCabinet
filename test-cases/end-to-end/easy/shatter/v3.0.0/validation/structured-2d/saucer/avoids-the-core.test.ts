// saucer/avoids-the-core — across fifty-four whole crossings, the saucer's circle
// never overlaps the star's core.
//
// THE RULE. `specs/saucer.md`, Geometry: "It is a powered craft... and it steers
// clear of the star's core: at no moment does the saucer's circle overlap the
// core, so its centre is never closer to `(STAR_X, STAR_Y)` than
// `CORE_R + SAUCER_R` (`48`). How far outside that it chooses to steer is the
// build's own." The distance is the whole requirement, and HOW a build keeps it is
// deliberately not.
//
// WHY FIFTY-FOUR CROSSINGS AND NOT ONE. This is the fold-in fix of `changelog.md`
// carried forward as a design property. The item this replaces lined the saucer up
// `60` units from the star at cruise — under half a second of warning — and a
// craft that answers with vertical speed while keeping its crossing speed still
// clips the core, so only one particular implementation survived: it failed
// conformant builds for the way they steer rather than for coming too close. What
// replaces it poses nothing but courses the specification's OWN entry rule
// produces — a saucer entering at a side, on a row, at cruise — and lets each one
// fly the whole width of the field with the build steering it. Fifty-four of them,
// because avoidance is frequently one-sided (which the rows either side of the
// star's are for) and a build that rerolls its weave on a timer can have the
// reroll discard the clearance it had accumulated, which is intermittent by
// construction and does not respect one tidy sample.
//
// THE FIFTY-FOUR. Nine rows, from `80` units below the star's row to `80` above it
// in `20`-unit steps, each flown from the left edge and from the right, the whole
// set repeated under three seeds. The seeds matter because the weave's first
// direction is a draw (`specs/simulation.md`), so the same row is a different
// crossing under each.
//
// THE VERDICT IS THE CLOSEST APPROACH OF ALL OF THEM, not of the first: one
// crossing that came too close breaks the rule however the other fifty-three went.
//
// THE DISTANCE IS MEASURED TO THE PATH, NOT TO THE SAMPLES. A crossing is `1097`
// ticks and the sweep samples it every eight, and the closest point of an approach
// falls BETWEEN two samples far more often than on one — so reading the samples
// alone reports the craft further out than it got, which is exactly the wrong
// direction for a check hunting a build that came too close.
// `geometry.ts`'s `closestApproachToStar` measures the star's distance to the
// straight line each pair of consecutive samples spans, and drops the pair that
// spans a wrap seam, since a craft that left one edge never travelled the line
// back to the other.
//
// THE GUN IS SHUT AND NOTHING ELSE IS ON THE FIELD. `setSaucerGun(false)` means
// fifty-four crossings produce no rounds at all — the steering is the requirement,
// and a round of the saucer's own has nothing to do with it. `startPlaying` leaves
// no rock and no other craft, shuts the wave loop and the game's own arrival, and
// shuts the ship's lethal contact test, so a crossing is the only thing happening.
// The mind and the travel are both left ON: the steering IS the mind, and it has
// to be flying to steer.
//
// THE RECORDING IS OF THE CLOSEST CROSSING, NOT THE FIRST. The sweep keeps the
// seed, row and side of the worst approach, and the crossing is then re-posed and
// flown again in front of an armed recorder — at one tick a frame, so the playback
// is the motion rather than a slideshow. Filming the first crossing instead loses
// the point of the fix: on a failing build the dead-on approach is frequently one
// it handles cleanly, and the item would read as a false positive to anyone
// watching. The film runs before the assertion, so a build that failed still
// leaves behind the approach the verdict rests on.

import { afterEach, it } from "vitest";
import { CORE_R, FIELD_W, SAUCER_R, SAUCER_SPEED, STAR_Y } from "../constants";
import { assertGreaterThan } from "../assert";
import { closestApproachToStar, type Vec } from "../geometry";
import {
  captureReplay,
  clearCalls,
  createHarness,
  poseSaucer,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { createMarchHarness, MARCH_TICKS } from "./visits";

/** The three seeds the whole set of crossings is repeated under. */
const SEEDS = [1, 2, 3] as const;

/** How far either side of the star's row the entry rows reach, and their step. */
const ROW_REACH = 80;
const ROW_STEP = 20;

/** The nine entry rows, from 80 below the star's row to 80 above it. */
const ROWS: number[] = [];
for (let row = STAR_Y - ROW_REACH; row <= STAR_Y + ROW_REACH; row += ROW_STEP) {
  ROWS.push(row);
}

/** The two sides a saucer enters at, as `specs/saucer.md` fixes them. */
const SIDES = [
  { name: "left", x: SAUCER_R, vx: SAUCER_SPEED },
  { name: "right", x: FIELD_W - SAUCER_R, vx: -SAUCER_SPEED },
] as const;

/**
 * The whole ticks a crossing of the field takes at cruise.
 *
 * `FIELD_W / SAUCER_SPEED` is `9.14` seconds, comfortably inside the
 * `SAUCER_LIFETIME` (`12` s) a visit lasts, so a crossing runs its whole width
 * before the craft is due to leave. A sweep stops early if the slot reports clear.
 */
const CROSSING_TICKS = ticksFor(FIELD_W / SAUCER_SPEED);

/** The marched frames one crossing is sampled over, one sample per frame. */
const CROSSING_FRAMES = Math.ceil(CROSSING_TICKS / MARCH_TICKS);

/**
 * The distance the saucer's centre must stay outside, in units.
 *
 * `CORE_R + SAUCER_R` (`30 + 18 = 48`) exactly, which is where the two circles
 * touch. `specs/saucer.md` states this figure itself and leaves how far beyond it
 * a build steers entirely open, so the rule itself has nothing added to it.
 */
const CLEARANCE = CORE_R + SAUCER_R;

/**
 * How far a chord may cut inside the path it spans: `0.4` units.
 *
 * Derived, not chosen, and it corrects a bias this check introduces rather than
 * widening the rule. {@link closestApproachToStar} reads the distance to the LINE
 * between two samples, not to the samples — without which a sweep striding
 * {@link MARCH_TICKS} ticks reports the saucer further out than it ever got. But a
 * straight line between two points on a curve passes inside it, so the correction
 * over-reads in the other direction by exactly the sagitta: a saucer holding the
 * bound exactly rides a circle of radius `CLEARANCE` about the star, two samples
 * eight ticks apart lie `SAUCER_SPEED * 8 / TICK_HZ` = `9.3` units apart along it —
 * `11.1` with a full weave — and the chord between them passes
 * `48 - sqrt(48^2 - 5.55^2)` = `0.32` units inside the circle. So a build that
 * really did hold `48`, which `specs/saucer.md` expressly permits ("How far outside
 * that it chooses to steer is the build's own"), would be read at `47.68` and
 * failed by a strict bound. This allowance is what stops the sweep's own stride
 * from deciding the verdict. It is 0.8 percent of the bound.
 */
const CHORD_ALLOWANCE = 0.4;

/** One crossing, as the sweep names it. */
interface Crossing {
  seed: number;
  row: number;
  side: (typeof SIDES)[number];
}

/** Pose one crossing on a harness already playing a quiet, empty game. */
function poseCrossing(h: Harness, crossing: Crossing): void {
  resetTo(h, crossing.seed);
  startPlaying(h);
  poseSaucer(h, crossing.side.x, crossing.row);
  // `addSaucer` brings the craft on travelling RIGHT at cruise; a crossing from
  // the right side is the same course turned round.
  h.debug.setSaucerVelocity(crossing.side.vx, 0);
  h.debug.setSaucerGun(false);
}

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("keeps every one of 54 crossings clear of CORE_R + SAUCER_R from the star's centre", async () => {
  const sweep = await createMarchHarness();
  harnesses.push(sweep);

  let closest = Infinity;
  let worst: Crossing = { seed: SEEDS[0], row: ROWS[0], side: SIDES[0] };

  for (const seed of SEEDS) {
    for (const row of ROWS) {
      for (const side of SIDES) {
        const crossing: Crossing = { seed, row, side };
        poseCrossing(sweep, crossing);

        const path: Vec[] = [];
        for (let frame = 0; frame <= CROSSING_FRAMES; frame += 1) {
          const saucer = sweep.snapshot().saucer;
          // The visit ended on its own clock: the rest of the width is not a
          // path the craft ever took.
          if (saucer === null) break;
          path.push({ x: saucer.x, y: saucer.y });
          if (frame < CROSSING_FRAMES) await sweep.advance(1);
          clearCalls(sweep);
        }

        const approach = closestApproachToStar(path);
        if (approach < closest) {
          closest = approach;
          worst = crossing;
        }
      }
    }
  }

  // The closest of the 54 crossings, flown again in front of the recorder at one
  // tick a frame — and before the assertion, so a failing build leaves the
  // approach its verdict rests on behind.
  const film = await createHarness();
  harnesses.push(film);
  await captureReplay(film, "closest", async () => {
    poseCrossing(film, worst);
    for (let tick = 0; tick < CROSSING_TICKS; tick += 1) {
      if (film.snapshot().saucer === null) break;
      await film.advance(1);
      clearCalls(film);
    }
  });

  assertGreaterThan(
    closest,
    CLEARANCE - CHORD_ALLOWANCE,
    `the closest any of the ${SEEDS.length * ROWS.length * SIDES.length} ` +
      "crossings brought the saucer's centre to the star's centre, against " +
      `CORE_R + SAUCER_R (${CLEARANCE}) less the ${CHORD_ALLOWANCE} units this ` +
      "sweep's own stride cuts off a curve — at no moment does the saucer's " +
      "circle overlap the core (specs/saucer.md); the worst was the crossing " +
      `from the ${worst.side.name} edge on row ${worst.row} under seed ` +
      `${worst.seed}`,
  );
});
