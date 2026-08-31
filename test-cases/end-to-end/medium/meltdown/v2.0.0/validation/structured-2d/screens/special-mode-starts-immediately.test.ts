// Meltdown — screens/special-mode-starts-immediately: each of the four special
// modes opens a run straight from the list.
//
// THE RULE. specs/screens.md, `modeselect`: "Any other row" — every row but
// Containment — leads to "`playing`, in the `opening` phase, on that mode."
// specs/modes.md gives the opening state: "A run that has just started is in the
// `opening` phase on Wave 1".
//
// ALL FOUR ROWS, BECAUSE ONE READING CANNOT TELL A LIST FROM A ROW. A build that
// wired one row and left the other three inert reads correctly on the one it
// wired, so each of the four is confirmed in turn from a fresh reset, and the
// failure names the row that did not open its run.
//
// THREE THINGS ARE READ PER ROW, and they are three because a wrong build gets
// each of them wrong on its own: the SCREEN is `playing` (a build that stops on
// the list has not started anything), the PHASE is `opening` (a build that drops
// the player into a build phase or a live wave has skipped the phase in which the
// first maze is laid), and the MODE is the row's own (a build that starts every
// row on Containment reaches `playing` in `opening` and is still wrong). The
// mode is the distinguishing value: a build that ignores the row lands on the
// same mode four times over, and no correct build does.
//
// CONTAINMENT IS DELIBERATELY NOT AMONG THEM. It is the one row that asks for a
// difficulty first, which is `screens.containment-opens-difficulty-select`'s
// requirement, and confirming it here would be reading that rule instead of this
// one.
//
// THE ROW AND ITS MODE COME OFF THE CASE'S OWN CONSTANTS. specs/screens.md lists
// `MODE_ITEMS` in the order specs/modes.md's table names the modes, so the row at
// index `i` is the mode `MODES[i]`, and neither the label nor the slug is written
// out here.
//
// EACH LEG OPENS FROM A RESET, so a leg is a fresh arrival at the list rather
// than a confirm posted on top of the last leg's run.

import { afterEach, beforeEach, it } from "vitest";
import { MODES, MODE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row Containment sits on: the one row this item is NOT about. */
const CONTAINMENT_ROW = MODE_ITEMS.indexOf("CONTAINMENT");

/** The four rows that open a run at once, as indices into `MODE_ITEMS`. */
const SPECIAL_ROWS = MODE_ITEMS.map((_, index) => index).filter(
  (index) => index !== CONTAINMENT_ROW,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run in the opening phase on the chosen mode from each of the four special rows", async () => {
  for (const row of SPECIAL_ROWS) {
    const label = MODE_ITEMS[row];
    resetTo(h);
    h.debug.setScreen("modeselect");
    h.debug.setMenuIndex(row);
    await h.advance(1);

    const before = h.snapshot();
    assertEqual(
      before.screen,
      "modeselect",
      `${label}: the screen the leg is posed on`,
    );
    assertEqual(before.menuIndex, row, `${label}: the row the leg is posed on`);

    await tapAction(h, "confirm");
    if (row === SPECIAL_ROWS[0]) captureStill(h, "started");

    const after = h.snapshot();
    assertEqual(
      after.screen,
      "playing",
      `${label}: the screen confirming row ${row} of the mode list leads to`,
    );
    assertEqual(
      after.phase,
      "opening",
      `${label}: the phase the run confirming row ${row} opens in`,
    );
    assertEqual(
      after.mode,
      MODES[row],
      `${label}: the mode the run confirming row ${row} opens on`,
    );
  }
});
