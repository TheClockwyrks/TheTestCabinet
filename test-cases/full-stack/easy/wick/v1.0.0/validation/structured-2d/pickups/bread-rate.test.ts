// pickups/bread-rate — bread drops at BREAD_CHANCE.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll"): "|
// Probability a common kill drops bread | `BREAD_CHANCE` | `0.02` |", applied
// as "A first draw, uniform on `[0, 1)`, drops bread when it is below
// `BREAD_CHANCE`". Every common kill makes that draw, so over `DROP_TRIALS`
// (`4000`) kills the bread count is binomial with `n` `4000` and `p` `0.02`:
// mean `80`, standard deviation `8.85`. `BREAD_COUNT_BOUNDS` (`[40, 125]`) puts
// both tails below one in a hundred thousand, so a conformant build fails by
// chance about never, while a build that never drops bread reads `0`, one that
// drops it on every kill reads `4000`, and one that mistook the chance for
// `DRAFT_CHANCE` (`0.005`) reads about `20` and one that mistook it for `0.2`
// reads about `800`. Where each bound comes from is spelled on
// `BREAD_COUNT_BOUNDS` in `constants.ts`.
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
// range, and `BREAD_COUNT_BOUNDS` is that range, wide enough that a conformant
// build passes and narrow enough that a wrong chance fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  BREAD_CHANCE,
  BREAD_COUNT_BOUNDS,
  DEFAULT_SEED,
  DROP_TRIALS,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { countOf, sampleDrops } from "./roll";

const [LOW, HIGH] = BREAD_COUNT_BOUNDS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("drops between 40 and 125 bread over 4000 seeded kills", async () => {
  const sample = await sampleDrops(h, DEFAULT_SEED, DROP_TRIALS);
  // The still is the last batch's own frame: the field its kills left.
  captureStill(h, "rate");

  assertEqual(sample.kills, DROP_TRIALS, "the common kills the sample made");
  assertBetween(
    countOf(sample.drops, "bread"),
    LOW,
    HIGH,
    `the bread ${DROP_TRIALS} common kills dropped, against the ${DROP_TRIALS * BREAD_CHANCE} expected at BREAD_CHANCE (specs/world.md, The drop roll)`,
  );
});
