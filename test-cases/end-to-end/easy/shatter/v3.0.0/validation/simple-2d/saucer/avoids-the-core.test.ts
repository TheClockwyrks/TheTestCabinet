// saucer/avoids-the-core — no crossing ever brings the saucer's circle over the
// star's core.
//
// THE RULE. `specs/saucer.md`: "It is a powered craft. The well never pulls it,
// and it steers clear of the star's core: at no moment does the saucer's circle
// overlap the core, so its centre is never closer to `(STAR_X, STAR_Y)` than
// `CORE_R + SAUCER_R` (`48`). HOW FAR OUTSIDE THAT IT CHOOSES TO STEER IS THE
// BUILD'S OWN." The one distance the specification fixes is therefore the only
// one this item may assert, and everything about the approach is left to the
// build.
//
// FIFTY-FOUR REAL CROSSINGS, NOT ONE POSED CONFRONTATION. This is the item the
// fold-in fix of `changelog.md` reshaped, and the reason is worth restating: a
// scenario that lines a saucer up sixty units from the star at cruise gives it
// under half a second of warning, and a craft that answers with vertical speed
// while keeping its crossing speed still clips the core — so the old check passed
// exactly one way of steering and failed conformant builds for the way they
// steer. What is flown here instead is the entry rule's own output: nine rows
// from eighty units below the star's to eighty above it, each from the left edge
// and from the right, the whole set from three seeds. Every one of them is a
// course the game itself produces, and the whole approach is the build's to
// steer.
//
// AND THE VERDICT IS THE WORST OF ALL FIFTY-FOUR, because avoidance is often
// one-sided — which the rows either side of the star are for — and because a
// build that rerolls its weave on a timer can have a reroll discard the avoidance
// it had accumulated, which is intermittent by construction and does not respect
// a tidy sample. Three seeds, because `specs/saucer.md` draws the direction of
// the first reroll at random and a saucer weaving into the star is a different
// crossing from one weaving away.
//
// THE DISTANCE IS MEASURED TO THE LINE BETWEEN SAMPLES. Reading the samples alone
// at this stride reports the saucer further out than it got, because the closest
// point of its path lies between two of them — which is the wrong direction for a
// check hunting a build that came too close. `geometry.ts`'s `closestApproachTo`
// is that reading.
//
// ONLY THE PART OF A CROSSING THAT CAN MATTER IS SAMPLED. A centre more than
// `WINDOW` units from the star's COLUMN is at least that far from the star's
// CENTRE — several times the `48` this item asserts — so no closest approach can
// lie out there, and the ground before the window is covered in one call and read
// not at all. The sampling starts when the saucer enters the window and ends when
// it leaves it on the far side, when the visit ends, or at `SAUCER_LIFETIME`,
// which is the ceiling the specification itself puts on a visit.
//
// THE GUN IS OFF, so fifty-four crossings put no round on the field at all. Its
// mind is on, because the steering IS the requirement.
//
// THE RECORDING IS THE CLOSEST CROSSING, NOT THE FIRST. On a failing build the
// dead-on approach is frequently one it handles cleanly, so filming the first
// would read as a false positive to anyone watching the playback. The sweep keeps
// the row, the edge and the seed of the worst approach, and the recorder is then
// armed over that crossing flown again.

import { afterEach, beforeEach, it } from "vitest";
import {
  CORE_R,
  FIELD_W,
  SAUCER_LIFETIME,
  SAUCER_R,
  SAUCER_SPEED,
  STAR_X,
  STAR_Y,
} from "../../src/constants";
import { assertGreaterThan, assertLessThan } from "../assert";
import { STAR, closestApproachTo, foldX, type Point } from "../geometry";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseVisit } from "./visit";

/** The nine entry rows: eighty units either side of the star's, in twenties. */
const ROW_OFFSETS = [-80, -60, -40, -20, 0, 20, 40, 60, 80] as const;

/** The two edges a saucer enters at, each heading into the field. */
const EDGES = [
  { name: "left", x: SAUCER_R, vx: SAUCER_SPEED },
  { name: "right", x: FIELD_W - SAUCER_R, vx: -SAUCER_SPEED },
] as const;

/** The three games the whole set is flown from. */
const SEEDS = [1, 2, 3] as const;

/** The distance `specs/saucer.md` fixes: `CORE_R + SAUCER_R` = `48`. */
const SAUCER_CLEARANCE = CORE_R + SAUCER_R;

/**
 * The eight ticks between two samples of a crossing.
 *
 * A fifteenth of a second, over which a saucer travelling at its cruise and
 * weaving at full vertical speed covers `11.1` units. That is what makes
 * fifty-four crossings affordable, and it is why the distance is read to the LINE
 * between samples rather than to the samples themselves.
 */
const SAMPLE_STRIDE = 8;

/**
 * How far a chord may cut inside the path it spans: `0.4` units.
 *
 * Derived, not chosen. A saucer holding the bound exactly would be travelling a
 * circle of radius `SAUCER_CLEARANCE` around the star, and the straight line
 * between two samples `11.1` units apart on that circle passes
 * `48 - sqrt(48^2 - 5.55^2)` = `0.32` units inside it. So a build that really did
 * hold `48` would be read at `47.68`, and this allowance is what stops the
 * sweep's own stride from failing it. It is 0.8 percent of the bound, and it
 * corrects a bias this check introduced rather than widening the rule.
 */
const CHORD_ALLOWANCE = 0.4;

/**
 * How long one crossing may run before the sweep gives up on it.
 *
 * `SAUCER_LIFETIME` is the ceiling the specification itself puts on a visit, so a
 * crossing that has not reached the far side of the window inside it has left the
 * field on its own clock and there is nothing further to sample.
 */
const CROSSING_CEILING = ticksFor(SAUCER_LIFETIME);

/**
 * How near the star's column a crossing is sampled at all: `320` units.
 *
 * Geometry, not a bound. Outside this the saucer's centre is at least `320` units
 * from the star's whatever its row, against the `48` the item asserts, so nothing
 * outside the window can be the closest approach and the ground it covers getting
 * there is skipped in one call.
 */
const WINDOW = 320;

/** The stride the ground before the window is covered in. Nothing is read there. */
const APPROACH_STRIDE = 60;

/** The ticks one pass through the window takes at the cruise, with room to spare. */
const WINDOW_TICKS = ticksFor((2 * WINDOW) / SAUCER_SPEED) + ticksFor(0.5);

/** A second of the crossing after the window, so the recording ends on the outcome. */
const TAIL_TICKS = ticksFor(1);

/** One crossing of the fifty-four: which row, which edge, which game. */
interface Crossing {
  seed: number;
  row: number;
  edge: (typeof EDGES)[number];
}

/** How near the star's column the saucer stands, across the seam. */
function columnGap(h: Harness): number {
  const saucer = h.snapshot().saucer;
  return saucer === null
    ? Number.POSITIVE_INFINITY
    : Math.abs(foldX(saucer.x - STAR_X));
}

/**
 * Follow the posed crossing past the star and answer the closest it came to the
 * star's centre, measured to the LINE between samples.
 *
 * The window is what makes fifty-four of these affordable: outside it the sweep
 * advances in `APPROACH_STRIDE` ticks and reads nothing, and inside it samples
 * every `SAMPLE_STRIDE`. It stops when the saucer leaves the window on the far
 * side, when the visit ends, or at the ceiling.
 */
async function crossingApproach(h: Harness): Promise<number> {
  const path: Point[] = [];
  let ran = 0;
  let entered = false;
  while (ran < CROSSING_CEILING) {
    const saucer = h.snapshot().saucer;
    if (saucer === null) break;
    const inside = Math.abs(foldX(saucer.x - STAR_X)) <= WINDOW;
    if (inside) {
      path.push({ x: saucer.x, y: saucer.y });
      entered = true;
    } else if (entered) {
      break;
    }
    const step = Math.min(
      inside ? SAMPLE_STRIDE : APPROACH_STRIDE,
      CROSSING_CEILING - ran,
    );
    await h.advance(step);
    ran += step;
  }
  return closestApproachTo(STAR, path).distance;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Pose one crossing from a fresh game at its own seed.
 *
 * EACH CROSSING IS SEEDED IN ITS OWN RIGHT, so a crossing is reproducible from
 * the three things that name it — the row, the edge and the seed — and the
 * recording at the end is the crossing the verdict rests on rather than one that
 * merely began the same way. `reset` is what seeds the draw `specs/saucer.md`
 * makes for the direction of the first weave reroll, and `startPlaying` empties
 * the field, shuts both world gates and switches the ship's contact test off.
 */
function poseCrossing(crossing: Crossing): void {
  h.debug.reset({ seed: crossing.seed });
  startPlaying(h);
  poseVisit(h, crossing.edge.x, crossing.row, {
    vx: crossing.edge.vx,
    vy: 0,
    mind: true,
    gun: false,
  });
}

it("keeps every one of 54 crossings clear of CORE_R + SAUCER_R", async () => {
  const crossings: Crossing[] = [];
  for (const seed of SEEDS) {
    for (const edge of EDGES) {
      for (const offset of ROW_OFFSETS) {
        crossings.push({ seed, row: STAR_Y + offset, edge });
      }
    }
  }

  let worst = Number.POSITIVE_INFINITY;
  let worstCrossing = crossings[0];

  for (const crossing of crossings) {
    poseCrossing(crossing);
    const closest = await crossingApproach(h);
    if (closest < worst) {
      worst = closest;
      worstCrossing = crossing;
    }
  }

  poseCrossing(worstCrossing);
  for (
    let ran = 0;
    ran < CROSSING_CEILING && columnGap(h) > WINDOW;
    ran += APPROACH_STRIDE
  ) {
    await h.advance(APPROACH_STRIDE);
  }
  await captureReplay(h, "closest", async () => {
    await h.advance(WINDOW_TICKS + TAIL_TICKS);
  });

  // A CROSSING THIS SWEEP NEVER SAW IS NOT A CROSSING THAT KEPT ITS DISTANCE.
  // Every one of the 54 is posed at an edge heading into the field, and
  // `specs/saucer.md` crosses it at `SAUCER_SPEED` (`140`), so `12` seconds of
  // visit carries it `1680` units — past the star's column whichever edge it came
  // in at. A build whose saucer never reached the window therefore never flew the
  // scenario, and this item fails on that rather than passing on an empty path.
  assertLessThan(
    worst,
    Number.POSITIVE_INFINITY,
    "a saucer reaching the star's column on at least one of 54 crossings, " +
      `each posed at an edge and crossing at SAUCER_SPEED (specs/saucer.md)`,
  );
  assertGreaterThan(
    worst,
    SAUCER_CLEARANCE - CHORD_ALLOWANCE,
    "how near the star's centre the closest of 54 crossings came — row " +
      `${worstCrossing.row}, from the ${worstCrossing.edge.name}, seed ` +
      `${worstCrossing.seed} (specs/saucer.md)`,
  );
});
