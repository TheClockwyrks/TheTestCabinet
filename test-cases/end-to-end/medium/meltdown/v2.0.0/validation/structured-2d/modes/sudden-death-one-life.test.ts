// Meltdown — modes/sudden-death-one-life: Sudden Death derives a single life.
//
// THE RULE. `specs/modes.md`'s derived-figures table gives the row "Sudden Death"
// `1` life where every other row reads `20`, and names both figures: "The
// starting lives are `START_LIVES` (`20`) on every mode but Sudden Death, whose
// `SUDDEN_DEATH_LIVES` is `1`". The mode's own section says it again: "Sudden
// Death opens on `1` life".
//
// WHAT IS READ. `startLives`, the derived field the surface has no setter for —
// `specs/instrumentation.md` lists it among the figures that "follow" the mode
// and difficulty. That a started run opens HOLDING `startLives` is
// `modes.run-opens-with-its-figures`, and what a single leak then does to that
// life is `modes.sudden-death-ends-on-one-leak`; a build could derive the figure
// and still open its runs on twenty, or open on one and never end the run, and
// the three grades stay separable.
//
// WHY THE FIGURE IS DISTINGUISHING ON ITS OWN. `1` is the only life count in the
// table that is not `20`, so a build that left the mode on the standard row reads
// `20` and a build that read a neighbouring row reads `20` as well. A build that
// took the mode's starting MONEY for its lives reads `300`. Lives are a whole
// number and `specs/modes.md` fixes the figure exactly, so there is no tolerance
// and the assertion is equality.

import { afterEach, beforeEach, it } from "vitest";
import { SUDDEN_DEATH_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The mode this point reads. */
const MODE = "suddendeath";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives a single starting life for Sudden Death", async () => {
  startRun(h, MODE);

  await h.advance(1);
  captureStill(h, "life");

  const figures = h.snapshot();
  assertEqual(figures.mode, MODE, "precondition: the mode the run is posed on");
  assertEqual(
    figures.startLives,
    SUDDEN_DEATH_LIVES,
    "the starting lives Sudden Death derives",
  );
});
