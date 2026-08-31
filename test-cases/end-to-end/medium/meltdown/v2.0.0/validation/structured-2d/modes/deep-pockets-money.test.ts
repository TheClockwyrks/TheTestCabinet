// Meltdown — modes/deep-pockets-money: Deep Pockets opens on ten thousand.
//
// THE RULE. `specs/modes.md`'s derived-figures table gives the row "Deep Pockets"
// a starting money of `10000`, and the file names the figure:
// `DEEP_POCKETS_MONEY` (`10000`). The mode's own section says it again: "Deep
// Pockets opens on `10000` money."
//
// WHAT IS READ. `startMoney`, the derived field the surface has no setter for —
// `specs/instrumentation.md` lists it among the figures that "follow" the mode
// and difficulty. That a started run opens HOLDING `startMoney` is
// `modes.run-opens-with-its-figures`, so a build could derive the right figure
// and still open a run on the wrong purse, and the two grades stay separable.
//
// WHY DEEP POCKETS' PURSE IS DISTINGUISHING ON ITS OWN. It is the only figure in
// the whole table above four digits, and it is more than sixteen times the next
// largest (`600`). So a build that left the mode on the Containment row reads
// `250`, one that gave it The Hundred's purse reads `600`, one that gave it
// Bottleneck's or Sudden Death's reads `300`, and one that dropped a digit reads
// `1000`. Money is a whole number of coins and `specs/modes.md` fixes it exactly,
// so there is no tolerance and the assertion is equality.
//
// The mode's other figure, that it pays no interest, is
// `modes.deep-pockets-no-interest`.

import { afterEach, beforeEach, it } from "vitest";
import { DEEP_POCKETS_MONEY } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The mode this point reads. */
const MODE = "deeppockets";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives ten thousand starting money for Deep Pockets", async () => {
  startRun(h, MODE);

  await h.advance(1);
  captureStill(h, "flush");

  const figures = h.snapshot();
  assertEqual(figures.mode, MODE, "precondition: the mode the run is posed on");
  assertEqual(
    figures.startMoney,
    DEEP_POCKETS_MONEY,
    "the starting money Deep Pockets derives",
  );
});
