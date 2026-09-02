// screens/special-mode-starts-immediately — confirming any of the four special
// modes opens a run on that mode at once.
//
// THE RULE. specs/screens.md's `modeselect` table: every row but `CONTAINMENT`
// leads to "`playing`, in the `opening` phase, on that mode." specs/modes.md adds
// why there is nothing to ask first — the four special modes fix their own
// starting money and wave count in their own rows, so none of them has a
// difficulty to choose.
//
// FOUR ROWS, FOUR CHECKS. Each mode is its own check, so a build that starts The
// Hundred and stalls on Bottleneck fails on the row it got wrong and the grade
// names it. Containment is not among them: its row leads somewhere else, and that
// is `screens.containment-opens-difficulty-select`'s requirement.
//
// THREE READINGS, BECAUSE THERE ARE THREE WAYS TO GET THIS ROW WRONG. The screen
// says the run opened at all; the phase says it opened where a run opens, in the
// untimed `opening` phase specs/waves.md puts before Wave 1, rather than mid-wave;
// and the mode says the run that opened is the one the row named, rather than
// whatever mode the game was already holding. That last one is the reason the mode
// is read: a build that moves the screen and ignores the row would run Containment
// under a Bottleneck heading.
//
// WHAT THE RUN'S FIGURES ARE IS NOT READ HERE. Which starting money and how many
// waves each mode sets is specs/modes.md's table and the `modes` group's items;
// this item is the route from the list into a run.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, MODES, MODE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The rows that lead straight to a run: every mode row but Containment's. */
const SPECIAL_ROWS = MODES.flatMap((mode, index) =>
  mode === "containment" ? [] : [index],
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

for (const row of SPECIAL_ROWS) {
  it(`starts a run on ${MODE_ITEMS[row]} the moment its row is confirmed`, async () => {
    poseMenu(h, "modeselect", row);
    await h.advance(1);
    assertEqual(
      h.snapshot().screen,
      "modeselect",
      "posing: the screen the press is made on (specs/screens.md)",
    );

    await h.tap(CONFIRM);
    captureStill(h, "started");

    const after = h.snapshot();
    assertEqual(
      after.screen,
      "playing",
      `${CONFIRM} on the ${MODE_ITEMS[row]} row: the screen it leads to ` +
        `(specs/screens.md)`,
    );
    assertEqual(
      after.phase,
      "opening",
      `${CONFIRM} on the ${MODE_ITEMS[row]} row: the phase a run opens in ` +
        `(specs/screens.md, specs/waves.md)`,
    );
    assertEqual(
      after.mode,
      MODES[row],
      `${CONFIRM} on the ${MODE_ITEMS[row]} row: the mode the run opened on ` +
        `(specs/screens.md)`,
    );
  });
}
