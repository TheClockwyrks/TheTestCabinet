// pickups/draft-rate — a draft drops at DRAFT_CHANCE.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll"): "|
// Probability a common kill drops a draft | `DRAFT_CHANCE` | `0.005` |",
// applied as "Only when it did not, a second draw drops a draft when it is
// below `DRAFT_CHANCE`". The second draw happens on the kills whose bread draw
// failed, so over `DROP_TRIALS` (`4000`) kills a draft arrives with probability
// `(1 − BREAD_CHANCE) × DRAFT_CHANCE`, giving a mean of `19.6` and a standard
// deviation of `4.42`. `DRAFT_COUNT_BOUNDS` (`[3, 45]`) puts both tails below
// one in a hundred thousand, so a conformant build fails by chance about never,
// while a build that never drops a draft reads `0`, one that drops one on every
// kill reads `4000`, and one that mistook the chance for `BREAD_CHANCE`
// (`0.02`) reads about `78`. Where each bound comes from is spelled on
// `DRAFT_COUNT_BOUNDS` in `constants.ts`.
//
// WHY THE WORLD IS POSED AS IT IS. `pickups/roll` makes the sample: an isolated
// night, every driver switch off, and four thousand moths killed by their own
// level-1 Oil Splash puddles on a lattice `200` units apart, far enough from
// the lamplighter that nothing is attracted or collected, so every drop is
// still on the field when its tick's snapshot is read. The seed is fixed, so a
// build's answer here is the same on every run of the check rather than a fresh
// coin toss. Every kill is a moth, rank `common`, which is what makes a kill
// draw at all.
//
// THE TOLERANCE. The interval itself: a rate is only readable as a count in a
// range, and `DRAFT_COUNT_BOUNDS` is that range, wide enough that a conformant
// build passes and narrow enough that a wrong chance fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  BREAD_CHANCE,
  DEFAULT_SEED,
  DRAFT_CHANCE,
  DRAFT_COUNT_BOUNDS,
  DROP_TRIALS,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { countOf, sampleDrops } from "./roll";

const [LOW, HIGH] = DRAFT_COUNT_BOUNDS;

/** The expected count: the second draw runs on the kills the first did not take. */
const EXPECTED = DROP_TRIALS * (1 - BREAD_CHANCE) * DRAFT_CHANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("drops between 3 and 45 drafts over 4000 seeded kills", async () => {
  const sample = await sampleDrops(h, DEFAULT_SEED, DROP_TRIALS);
  // The still is the last batch's own frame: the field its kills left.
  captureStill(h, "rate");

  assertEqual(sample.kills, DROP_TRIALS, "the common kills the sample made");
  assertBetween(
    countOf(sample.drops, "draft"),
    LOW,
    HIGH,
    `the drafts ${DROP_TRIALS} common kills dropped, against the ${EXPECTED} expected at DRAFT_CHANCE after a failed bread draw (specs/world.md, The drop roll)`,
  );
});
