// screens/containment-opens-difficulty-select — confirming Containment opens the
// difficulty screen rather than starting a run.
//
// THE RULE. specs/screens.md's `modeselect` table gives the `CONTAINMENT` row one
// destination, `difficultyselect`, where every other row goes straight to
// `playing`. specs/modes.md says why: Containment "is the only mode with a
// difficulty", and the difficulty is what sets its starting money and its wave
// count, so the choice has to be made before the run opens.
//
// THE DIRECTION THIS ITEM DECIDES is Containment's alone. That the OTHER four rows
// start at once is `screens.special-mode-starts-immediately`'s requirement, and
// what the difficulty screen then lists is `screens.difficulty-lists-three`'s. A
// build that sends every row to the difficulty screen fails that item and passes
// this one, and a build that starts Containment on the spot fails this one alone —
// which is the split a grade needs to name what the build got wrong.
//
// THE RUN MUST NOT HAVE BEGUN, and that is read as well as the screen. A build
// that opened the difficulty screen over a run already running would report the
// right screen while having taken the choice away, so the phase is read too: a run
// that has just started is in the `opening` phase (specs/modes.md), and this press
// must leave the game on a menu instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, MODES, MODE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row Containment sits on, first of the six rows of the mode list. */
const CONTAINMENT_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens difficulty select when Containment is confirmed", async () => {
  assertEqual(
    MODES[CONTAINMENT_ROW],
    "containment",
    "posing: the mode this item is about (specs/modes.md, MODES)",
  );
  assertEqual(
    MODE_ITEMS[CONTAINMENT_ROW],
    "CONTAINMENT",
    "posing: the row that mode is drawn as (specs/screens.md, MODE_ITEMS)",
  );
  poseMenu(h, "modeselect", CONTAINMENT_ROW);
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "modeselect",
    "posing: the screen the press is made on (specs/screens.md)",
  );

  await h.tap(CONFIRM);
  captureStill(h, "difficulty");

  assertEqual(
    h.snapshot().screen,
    "difficultyselect",
    `${CONFIRM} on the CONTAINMENT row: the screen it leads to, since ` +
      `Containment is the one mode whose difficulty is chosen first ` +
      `(specs/screens.md, specs/modes.md)`,
  );
});
