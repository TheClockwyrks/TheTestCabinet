// modes/deep-pockets-money — Deep Pockets opens on ten thousand.
//
// THE RULE. specs/modes.md's derived-figures table gives the row
// "Deep Pockets | 10000", names the constant underneath it — `DEEP_POCKETS_MONEY`
// (`10000`) — and states that starting money follows the mode "and nothing else".
// The figure is read back as `startMoney` (specs/instrumentation.md).
//
// TEN THOUSAND IS THE MOST DISTINGUISHING FIGURE IN THE TABLE. Every other row's
// starting sum is between `200` and `600`; this one is more than sixteen times the
// largest of them, and the whole point of the mode is that money stops being the
// constraint. A build that fell back to Containment's table reads `250`, one that
// read The Hundred reads `600`, one that read Bottleneck or Sudden Death reads
// `300`, and one that mistook the figure for a cap or a multiplier reads neither
// `10000` nor any of those.
//
// WHY THE FIGURE IS READ FROM THE CASE'S OWN TABLE. `MODE_TABLE` is in
// `src/constants.ts`, the module the case SEEDS and the build is told not to edit,
// and specs/modes.md names it as where the row lives. So the expected figure is the
// one the build was handed, and the assertion is exact: a whole number a
// specification fixes outright, with no tolerance on it.
//
// NOTHING BUT THE MODE IS POSED before the reading. The run's live money, lives and
// wave are posed afterwards, from the figures the BUILD derived, so the still a
// reviewer opens shows the build's own answer on the HUD (modes/run.ts).
//
// WHAT THIS POINT DOES NOT DECIDE. That Deep Pockets pays no interest is
// `modes.deep-pockets-no-interest`; that a started run is actually handed the sum is
// `modes.run-opens-with-its-figures`.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_TABLE } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawOpening, poseMode } from "./run";

/** The mode this point reads. */
const MODE = "deeppockets";

/** The row specs/modes.md gives it, as the case seeded it. */
const ROW = MODE_TABLE[MODE];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 10000 starting money for Deep Pockets", async () => {
  poseMode(h, MODE);
  const derived = h.snapshot();

  await drawOpening(h);
  captureStill(h, "flush");

  assertEqual(
    derived.startMoney,
    ROW.startMoney,
    "the startMoney Deep Pockets derives (specs/modes.md, The derived figures)",
  );
});
