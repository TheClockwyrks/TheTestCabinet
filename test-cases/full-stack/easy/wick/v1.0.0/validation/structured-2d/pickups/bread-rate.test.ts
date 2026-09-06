// pickups/bread-rate — bread drops at BREAD_CHANCE.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll"): "|
// Probability a common kill drops bread | `BREAD_CHANCE` | `0.02` |", applied
// as "The roll drops bread with probability `BREAD_CHANCE`". The roll is a
// probability, so it is read over a sample of the roll alone: `rollDrop()`
// "Makes one drop roll exactly as `specs/world.md` states under The drop roll
// and returns what it decided" (`specs/instrumentation.md`, Drawn outcomes).
// Over `DROP_ROLLS` (`40000`) rolls the bread count is binomial with `n`
// `40000` and `p` `0.02`: mean `800`, standard deviation `28`.
// `BREAD_COUNT_BOUNDS` (`[632, 968]`) sits six deviations either side of the
// mean, so a conformant build fails by chance about once in a thousand
// million runs, while a build that never rolls bread reads `0`, one that
// rolls it on every call reads `40000`, one that mistook the chance for
// `DRAFT_CHANCE` (`0.005`) reads about `200` and one that mistook it for `0.2`
// about `8000`. Where each bound comes from is spelled on
// `BREAD_COUNT_BOUNDS` in `constants.ts`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, which the rolls leave as
// it is: `pickups/roll` makes the sample as forty thousand calls of `rollDrop`
// over it, with nothing posed for the roll, so each roll is the build's own.
//
// THE TOLERANCE. The interval itself: a rate is only readable as a count in a
// range, and `BREAD_COUNT_BOUNDS` is that range, wide enough that a conformant
// build passes and narrow enough that a wrong chance fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { BREAD_CHANCE, BREAD_COUNT_BOUNDS, DROP_ROLLS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { rollDrops } from "./roll";

const [LOW, HIGH] = BREAD_COUNT_BOUNDS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("rolls between 632 and 968 breads over 40000 rolls", async () => {
  isolate(h);
  const sample = rollDrops(h, DROP_ROLLS);
  await h.frameDraw();
  captureStill(h, "rate");

  assertEqual(sample.rolls, DROP_ROLLS, "the rolls the sample made");
  assertBetween(
    sample.counts.bread,
    LOW,
    HIGH,
    `the breads ${DROP_ROLLS} rolls decided, against the ${DROP_ROLLS * BREAD_CHANCE} expected at BREAD_CHANCE (specs/world.md, The drop roll)`,
  );
});
