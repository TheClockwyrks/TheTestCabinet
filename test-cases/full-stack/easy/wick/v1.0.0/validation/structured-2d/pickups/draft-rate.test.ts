// pickups/draft-rate — a draft drops at DRAFT_CHANCE, on the rolls that
// dropped no bread.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll"): "|
// Probability a common kill drops a draft | `DRAFT_CHANCE` | `0.005` |",
// applied as "only when it dropped no bread it drops a draft with probability
// `DRAFT_CHANCE`". The roll is a probability, so it is read over a sample of
// the roll alone: `rollDrop()` "Makes one drop roll exactly as
// `specs/world.md` states under The drop roll and returns what it decided"
// (`specs/instrumentation.md`, Drawn outcomes). A draft is rolled for on the
// `1 − BREAD_CHANCE` share of rolls that dropped no bread, so over
// `DROP_ROLLS` (`40000`) rolls the draft count is binomial with mean `196` and
// standard deviation `14`. `DRAFT_COUNT_BOUNDS` (`[112, 280]`) sits six
// deviations either side of the mean, so a conformant build fails by chance
// about once in a thousand million runs, while a build that never rolls a
// draft reads `0`, one at half the chance about `98`, and one at twice it
// about `392`. Where each bound comes from is spelled on `DRAFT_COUNT_BOUNDS`
// in `constants.ts`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, which the rolls leave as
// it is: `pickups/roll` makes the sample as forty thousand calls of `rollDrop`
// over it, with nothing posed for the roll, so each roll is the build's own.
//
// THE TOLERANCE. The interval itself: a rate is only readable as a count in a
// range, and `DRAFT_COUNT_BOUNDS` is that range, wide enough that a conformant
// build passes and narrow enough that a wrong chance fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  BREAD_CHANCE,
  DRAFT_CHANCE,
  DRAFT_COUNT_BOUNDS,
  DROP_ROLLS,
} from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { rollDrops } from "./roll";

const [LOW, HIGH] = DRAFT_COUNT_BOUNDS;

/** The drafts expected: the rolls that dropped no bread, at `DRAFT_CHANCE`. */
const EXPECTED = DROP_ROLLS * (1 - BREAD_CHANCE) * DRAFT_CHANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("rolls between 112 and 280 drafts over 40000 rolls", async () => {
  isolate(h);
  const sample = rollDrops(h, DROP_ROLLS);
  await h.frameDraw();
  captureStill(h, "rate");

  assertEqual(sample.rolls, DROP_ROLLS, "the rolls the sample made");
  assertBetween(
    sample.counts.draft,
    LOW,
    HIGH,
    `the drafts ${DROP_ROLLS} rolls decided, against the ${EXPECTED} expected at DRAFT_CHANCE on the rolls that dropped no bread (specs/world.md, The drop roll)`,
  );
});
