// screens/back-from-difficulty-select — Escape on the difficulty screen goes back
// to the mode list.
//
// THE RULE. specs/screens.md's `difficultyselect` section: "`back` returns to
// `modeselect`." specs/controls.md binds `back` to `Escape` and resolves it in a
// stated order — cancel a held placement, else deselect, else pause from live
// play, else "leave the current screen, as `specs/screens.md` states." On a menu
// screen nothing is armed and nothing is selected, so the fourth case is the one
// that applies and the screen is what moves.
//
// ONE STEP BACK, NOT TWO. The difficulty screen sits one screen in front of the
// mode list, so `back` from it must land on the list rather than on the title.
// A build that unwinds the whole way to the title strands a player who wanted a
// different mode with a second press to make, and reads `title` here.
//
// THE PRECONDITION IS POSED, NOT NAVIGATED TO. `setScreen` runs no entry effect
// (specs/instrumentation.md), and `reset` leaves nothing armed and nothing
// selected — so `back`'s earlier cases are genuinely absent rather than assumed
// away, and the press resolves on the screen.

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

it("returns to the mode list from the difficulty screen", async () => {
  poseMenu(h, "difficultyselect", OPENING_ROW);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "difficultyselect",
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
    "modeselect",
    `${BACK} on the difficulty screen: the screen behind it ` +
      `(specs/screens.md)`,
  );
});
