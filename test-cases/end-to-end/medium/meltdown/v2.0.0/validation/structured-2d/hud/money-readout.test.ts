// hud/money-readout — the panel draws the current money, and the readout follows
// it.
//
// THE RULE. specs/hud.md, The status readouts: the panel "draws three readouts at
// all times during a run", the Money one labelled `HUD_MONEY_LABEL` (`MONEY`) and
// showing "The current money". And: "Each readout follows its value as it
// changes."
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING. specs/hud.md fixes the LABEL as a
// constant and fixes nothing whatever about where the readout sits or how the
// value is formatted — "Where each element sits inside the strip is the build's
// own layout choice" — so what is read is the panel's own text: the label as a
// standalone word, and the value as a NUMBER parsed out of some run of text drawn
// in the panel's strip (`hud/panel.ts`). A build drawing `MONEY 137` in one run
// and one drawing the label and the figure as two runs both read the same here,
// which is what leaving the layout to the build means.
//
// TWO VALUES, BECAUSE ONE CANNOT TELL A READOUT FROM A CAPTION. A panel that drew
// the starting money once and never looked again reads correctly at the first
// value and wrongly at the second, so the second half of the point — the first
// value GONE and the second there — is what makes this a reading of the live
// money.
//
// WHY THESE TWO NUMBERS. `137` and `482` are three-digit figures that no other
// number this panel can draw is equal to: not a build cost (`15`, `40`, `45`,
// `60`, `150`, `20`), not a footprint side, not the wave or the wave count, not
// the build countdown, and not one of the coming Mote wave's figures. So a run
// carrying one of them is carrying the money, and a build that has stopped
// following the money reads the stale figure rather than a coincidence.
//
// `setMoney` "sets the money outright, spending and paying nothing"
// (specs/instrumentation.md), so posing a figure moves the readout and nothing
// else.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_MONEY_LABEL } from "../constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, reads, saysWord } from "./panel";

/** The money posed first: a figure no other panel number equals. */
const FIRST = 137;

/** The money posed second, which the readout must move to. */
const SECOND = 482;

/**
 * How far a drawn number may sit from the money and still be the money: nothing.
 *
 * The money is a whole number of money and specs/hud.md asks for "the current
 * money", so the window is only wide enough to carry a build that draws the
 * figure with a decimal point after it (`137.0`).
 */
const EXACT = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the money in the panel and follows setMoney", async () => {
  startRun(h);

  h.debug.setMoney(FIRST);
  const first = await readPanel(h);
  captureStill(h, "money");

  h.debug.setMoney(SECOND);
  const second = await readPanel(h);

  assertTrue(
    saysWord(first, HUD_MONEY_LABEL),
    `the panel to draw the ${HUD_MONEY_LABEL} label (specs/hud.md)`,
  );
  assertTrue(
    reads(first, FIRST, EXACT),
    `the panel to read ${FIRST} with the money at ${FIRST} (specs/hud.md)`,
  );
  assertTrue(
    reads(second, SECOND, EXACT),
    `the panel to read ${SECOND} once the money moved to ${SECOND}`,
  );
  assertTrue(
    !reads(second, FIRST, EXACT),
    `the panel to have stopped reading ${FIRST} once the money moved to ` +
      `${SECOND}`,
  );
});
