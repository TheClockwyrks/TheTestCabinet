// Meltdown — modes/hundred-figures: The Hundred opens on 600, keeps the standard
// 20 lives, and pays no interest.
//
// THE RULE. `specs/modes.md`'s derived-figures table gives the row "The Hundred"
// a starting money of `600`, `20` lives and `no` interest, and names the figures:
// "The starting lives are `START_LIVES` (`20`) on every mode but Sudden Death"
// and `HUNDRED_MONEY` is `600`. The same table says those figures "all follow the
// mode and difficulty and nothing else".
//
// WHY ALL THREE IN ONE POINT, AND WHY NOT THE WAVE COUNT. These three are the one
// requirement "The Hundred's row" — the figures a build reads off the mode table
// the moment the mode is chosen, before a single frame of the onslaught has run.
// The row's remaining figures are decided elsewhere by what they DO rather than
// by what they read: the wave count of `1` is
// `modes.hundred-has-no-build-phases`, which drives a clear and watches the run
// end instead of opening a build phase, and the release of `100` is
// `modes.hundred-releases-one-hundred`.
//
// THE FIGURES ARE READ, NOT SPENT. `startMoney`, `startLives` and `interest` are
// snapshot fields with no setter — `specs/instrumentation.md` lists them among
// the figures that "follow" the mode — so this reads the derivation itself.
// Whether a started run opens HOLDING `startMoney` is
// `modes.run-opens-with-its-figures`, and whether a build phase actually pays no
// interest is `modes.deep-pockets-no-interest`'s question for its own mode; a
// build could get the flag right and the payment wrong.
//
// WHAT EVERY WRONG MODEL READS. A build that left The Hundred on the Containment
// row reads `250` money and `true` interest; one that gave it Deep Pockets' purse
// reads `10000`; one that gave it Sudden Death's lives reads `1`; one that pays
// interest because every mode does reads `true`. Each is a different reading from
// `600`/`20`/`false`. There is no tolerance on any of them: money and lives are
// whole numbers and interest is a flag.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUNDRED_MONEY, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The mode this point reads. */
const MODE = "hundred";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 600 starting money, 20 lives and no interest for The Hundred", async () => {
  startRun(h, MODE);
  // The Hundred has one untimed opening phase and no build phase between waves
  // (`specs/modes.md`), so the run is posed on the phase the mode actually has.
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(0);

  await h.advance(1);
  captureStill(h, "figures");

  const figures = h.snapshot();
  assertEqual(figures.mode, MODE, "precondition: the mode the run is posed on");
  assertEqual(
    figures.startMoney,
    HUNDRED_MONEY,
    "the starting money The Hundred derives",
  );
  assertEqual(
    figures.startLives,
    START_LIVES,
    "the starting lives The Hundred derives",
  );
  assertEqual(figures.interest, false, "whether The Hundred pays interest");
});
