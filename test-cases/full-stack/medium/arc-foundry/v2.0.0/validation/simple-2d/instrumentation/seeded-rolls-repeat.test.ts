// instrumentation/seeded-rolls-repeat — every random draw runs off a generator
// `reset` seeds, so the same seed and the same calls reach the same rolls.
//
// WHY IT MATTERS BEYOND REPRODUCIBILITY. `specs/instrumentation.md` puts the
// press's type and quality rolls, each wave's composition, and every crit roll on
// one seeded generator whose whole state `reset` restores. A build that reaches
// for `Math.random` anywhere in that list makes every scenario in this project
// unrepeatable — a check that passed once fails the next time for no reason a
// reviewer can see — and it makes the game itself impossible to compare between
// two runs.
//
// The press is where the generator is easiest to read: a rock rolls its type and
// its quality the instant it lands, and the snapshot reports both. So the same
// counted run of placements is taken twice off the same seed, and the two
// sequences are held against each other.

import { afterEach, beforeEach, it } from "vitest";
import { REFINEMENT_MAX, STAMPS_PER_LEVEL } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  clearHand,
  createHarness,
  lastStructure,
  refillStamps,
  type Harness,
} from "../harness";

/** The seed both runs are taken under. */
const SEED = 42;

/**
 * The refinement level the rolls are taken at.
 *
 * The top rung, so the quality axis has four outcomes to disagree about rather
 * than the one `R0` allows (`specs/scrap-press.md`). It buys nothing: the
 * operation sets the level without spending Charge.
 */
const REFINEMENT = REFINEMENT_MAX;

/** Twelve clear anchors on the Substation, off every waypoint platform. */
const ANCHORS = [8, 12].flatMap((row) =>
  [10, 14, 18, 22, 26, 30].map((col) => ({ col, row })),
);

/** One rolled candidate, as the snapshot reports it. */
interface Roll {
  type: string | null;
  quality: number | null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Take the whole run of placements off a freshly seeded generator. */
async function rollRun(): Promise<Roll[]> {
  h.debug.reset({ seed: SEED });
  h.debug.startRun();
  h.debug.setRefinement(REFINEMENT);

  const rolled: Roll[] = [];
  for (const [at, anchor] of ANCHORS.entries()) {
    // The allowance is five per level and this run places more than that; the
    // refill poses the stamps and touches nothing else.
    if (at % STAMPS_PER_LEVEL === 0) refillStamps(h);
    h.debug.placeRock(anchor.col, anchor.row);
    const s = h.snapshot();
    assertEqual(
      s.structures.length,
      at + 1,
      `the yard to carry ${at + 1} candidates after ${at + 1} drops`,
    );
    const candidate = lastStructure(s);
    rolled.push({ type: candidate.type, quality: candidate.quality });
  }
  clearHand(h);
  return rolled;
}

it("rolls the same types and qualities, in the same order, off the same seed", async () => {
  const first = await rollRun();
  const second = await rollRun();
  await h.advance(1);
  captureStill(h, "rolls");

  assertDeepEqual(
    second,
    first,
    `the ${ANCHORS.length} rolls a run seeded ${SEED} produced the first time`,
  );
});
