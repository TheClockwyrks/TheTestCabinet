// screens/back-from-mode-select — Escape on the mode list goes back to the title.
//
// THE RULE. specs/screens.md's `modeselect` section: "`back` returns to `title`."
// specs/controls.md binds `back` to `Escape` and resolves it in a stated order —
// cancel a held placement, else deselect, else pause from live play, else "leave
// the current screen". On a menu screen nothing is armed and nothing is selected,
// so the last case is the one that applies.
//
// THE MODE LIST IS ONE SCREEN IN FROM THE TITLE, so `back` from it lands on the
// title and starts nothing: the title is where the game began, and specs/screens.md
// says of it that "`back` does nothing here", so there is nowhere further to
// unwind to. A build that answers the press by starting a run is the failure that
// matters, and the phase would show it.
//
// THE PRECONDITION IS POSED, NOT NAVIGATED TO. `setScreen` runs no entry effect
// (specs/instrumentation.md), so what is graded is the press rather than the route
// that reached the screen.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `back` to. */
const BACK = BINDINGS.back[0];

/** The row the screen is posed on: the first, which is where a menu opens. */
const OPENING_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the mode list", async () => {
  poseMenu(h, "modeselect", OPENING_ROW);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "modeselect",
    "posing: the screen the press is made on (specs/screens.md)",
  );
  assertNull(
    before.build,
    "posing: nothing is armed, so `back` resolves on the screen " +
      "(specs/controls.md)",
  );
  assertNull(
    before.selected,
    "posing: nothing is selected, so `back` resolves on the screen " +
      "(specs/controls.md)",
  );

  await h.tap(BACK);
  captureStill(h, "back");

  assertEqual(
    h.snapshot().screen,
    "title",
    `${BACK} on the mode list: the screen behind it (specs/screens.md)`,
  );
});
