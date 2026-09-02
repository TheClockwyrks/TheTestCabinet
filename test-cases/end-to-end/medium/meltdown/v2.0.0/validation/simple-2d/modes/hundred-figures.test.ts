// modes/hundred-figures — The Hundred opens with 600 money and 20 lives, and pays
// no interest.
//
// THE RULE. specs/modes.md's derived-figures table gives the row
// "The Hundred | 600 | 1 | 20 | no", and names the constants underneath it: the
// starting lives are `START_LIVES` (`20`) "on every mode but Sudden Death", and
// the starting sum is `HUNDRED_MONEY` (`600`). All three figures follow the mode
// "and nothing else", and the snapshot reports them as `startMoney`, `startLives`
// and `interest` (specs/instrumentation.md).
//
// THREE FIGURES, AND EACH ONE DISTINGUISHES A DIFFERENT WRONG MODEL. `600` is
// shared with no other row — a build that fell back to Containment's table reads
// `250`, one that read Deep Pockets reads `10000`, one that read Bottleneck or
// Sudden Death reads `300`. `20` lives is what a build that confused The Hundred's
// harder surge with Sudden Death's single life would get wrong. And `interest`
// `false` is the flag a build carries when it gives the mode the standard economy:
// The Hundred and Deep Pockets are the two rows that read `no`.
//
// WHY THE FIGURES ARE READ FROM THE CASE'S OWN TABLE. `MODE_TABLE` and
// `START_LIVES` are in `src/constants.ts`, the module the case SEEDS and the build
// is told not to edit, and specs/modes.md names them as where the row lives. So the
// expected figures are the ones the build was handed, and the assertions are exact:
// whole numbers and a flag a specification fixes outright, with no tolerance on
// them.
//
// INTEREST IS READ AS THE FLAG, NOT AS A PAYMENT. Whether a mode with `interest`
// false actually pays nothing on entering a build phase is
// `modes.deep-pockets-no-interest`'s requirement, and The Hundred has no build
// phase between waves to enter at all (specs/modes.md, The Hundred). So what this
// point reads is the derived field, which is what the specification states for this
// row.
//
// NOTHING BUT THE MODE IS POSED before the reading. The run's live money, lives and
// wave are posed afterwards, from the figures the BUILD derived, so the still a
// reviewer opens shows the build's own answer on the HUD (modes/run.ts).

import { afterEach, beforeEach, it } from "vitest";
import { MODE_TABLE, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawOpening, poseMode } from "./run";

/** The mode this point reads. */
const MODE = "hundred";

/** The row specs/modes.md gives it, as the case seeded it. */
const ROW = MODE_TABLE[MODE];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 600 starting money, 20 lives and no interest for The Hundred", async () => {
  poseMode(h, MODE);
  const derived = h.snapshot();

  await drawOpening(h);
  captureStill(h, "figures");

  assertEqual(
    derived.startMoney,
    ROW.startMoney,
    "the startMoney The Hundred derives (specs/modes.md, The derived figures)",
  );
  assertEqual(
    derived.startLives,
    START_LIVES,
    "the startLives The Hundred derives (specs/modes.md, The derived figures)",
  );
  assertEqual(
    derived.interest,
    false,
    "whether The Hundred pays interest (specs/modes.md, The derived figures)",
  );
});
