// Meltdown — screens/special-mode-starts-immediately: each of the four special
// modes starts straight from the list.
//
// THE RULE. `specs/screens.md`, on `modeselect`'s five rows: "Any other row" than
// Containment leads to "`playing`, in the `opening` phase, on that mode". So the
// four special modes have no second screen and no confirmation: confirming the row
// is the whole of starting the run. `specs/modes.md` adds that "A run that has just
// started is in the `opening` phase on Wave 1".
//
// WHY THIS ITEM IS CAPPED `broken` AND NAMES EVERY FUNCTIONAL DOMAIN. It is the
// only door to four of the five modes. A build that cannot pass it leaves The
// Hundred, Deep Pockets, Bottleneck and Sudden Death unreachable, so their heat,
// defence, run and presentation are all unreadable — and since a run's functional
// rating is the worst across the domains in play, an item naming presentation
// alone would leave such a build carrying a flawless heat, defence and run rating.
//
// ALL FOUR ROWS, BECAUSE THE ROW AND THE MODE MUST AGREE. Confirming row 3 must
// open Bottleneck, not Deep Pockets. So each row is confirmed in turn and the mode
// the run opened on is read back, which is what catches a build whose list is
// wired one row off — a failure that a single row could hide.
//
// THREE READINGS PER ROW, EACH NAMING A DIFFERENT WRONG MODEL. The screen catches
// a build that led to the difficulty list, or nowhere; the phase catches one that
// dropped the player into a build phase or mid-wave rather than the opening; and
// the mode catches one that started the wrong run. `specs/modes.md`'s own figures
// for each mode are `modes.*`'s reading, not this one's — this item is about the
// door.
//
// THE ROW IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row outright
// (`specs/instrumentation.md`), so a build whose arrow keys are broken still gets a
// fair reading of where each of its rows leads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODES, MODE_ITEMS, type ModeId } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/**
 * The four rows that start a run outright: every mode but Containment, which has
 * a difficulty list of its own (`specs/screens.md`).
 */
const SPECIAL_ROWS: readonly { row: number; mode: ModeId }[] = MODES.flatMap(
  (mode, row) => (mode === "containment" ? [] : [{ row, mode }]),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("starts each of the four special modes in the opening phase from its own row", async () => {
  const { debug } = h;
  for (const { row, mode } of SPECIAL_ROWS) {
    const where = `${MODE_ITEMS[row]}, row ${row} of ${MODE_ITEMS.length} on the mode list`;

    await debug.reset();
    await debug.setScreen("modeselect");
    await debug.setMenuIndex(row);
    await h.advance(1);

    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      "modeselect",
      `the screen the scenario is posed on, confirming ${where}`,
    );
    assertEqual(posed.menuIndex, row, `the row posed for ${where}`);

    await tapAction(h, "confirm");
    await h.advance(1);
    await captureStill(h, "started");

    const after = await h.snapshot();
    assertEqual(after.screen, "playing", `the screen confirming ${where} leads to`);
    assertEqual(after.phase, "opening", `the phase confirming ${where} opens in`);
    assertEqual(after.mode, mode, `the mode confirming ${where} starts`);
  }
});
