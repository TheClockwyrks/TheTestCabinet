// Spectra — screens/howto-reachable: confirming the how-to entry opens how to play.
//
// THE RULE. `specs/ui.md` gives the title menu two entries and says what `confirm`
// does with each: the mode entry "Opens a new run and moves to `stageIntro`", and
// `HOW TO PLAY` "Moves to `howto`". This point decides the second of those two
// routes, and nothing else.
//
// THE DISTINGUISHING POSE. `specs/ui.md` rests the highlight on the FIRST item on
// arriving at the title, so a build whose confirm ignores the highlight and always
// opens the mode is indistinguishable from a correct one at index `0`. Posed at the
// how-to entry, every wrong model reads as a different screen: a confirm wired to
// nothing leaves the game on `title`, a confirm that ignores the highlight opens
// `stageIntro`, and only a confirm that takes the highlighted item opens `howto`.
// The highlight is placed with `setMenuIndex`, which is what
// `specs/instrumentation.md` provides for posing exactly this, rather than walked to
// with the menu keys, whose own points are `controls/menu-up-*` and
// `controls/menu-down-*`.
//
// WHICH ENTRY IS THE HOW-TO ONE is the second: `TITLE_ITEMS` opens with the entry
// the mode this build ships names (`specs/mode.md`), and the second entry is
// `HOW TO PLAY` under either mode.
//
// THE KEY IS A REAL ONE, AND IT IS THE SPECIFICATION'S. `tap` presses and releases
// it at the engine's own event target and runs the one frame that delivers the armed
// edge, exactly as the engine resolves a player's key. The code is the LITERAL
// `specs/controls.md` states rather than `BINDINGS.confirm[…]`, which is the build's
// own copy of the table.
//
// WHAT IS NOT ASSERTED. That `Enter` is one of `confirm`'s keys is
// `controls/confirm-enter`'s and `controls/confirm-space`'s; what the how-to screen
// SAYS is `screens/howto-content`'s; that `back` leaves it again is
// `screens/howto-returns`'s. This point reads the screen the press arrived at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { HOWTO_ITEM, titleItems } from "./reading";

/** Which entry of `TITLE_ITEMS` is highlighted before the press. */
const HOWTO_INDEX = 1;

/** A key `specs/controls.md` binds `confirm` to, written out as it states it. */
const CONFIRM_KEY = "Enter";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to-play screen when the how-to entry is confirmed", async () => {
  await h.advance(1);
  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the game opens on the title screen (specs/ui.md)",
  );
  assertEqual(
    titleItems(opened.mode)[HOWTO_INDEX],
    HOWTO_ITEM,
    "the second TITLE_ITEMS entry is HOW TO PLAY (specs/ui.md)",
  );

  h.debug.setMenuIndex(HOWTO_INDEX);
  await h.advance(1);
  assertEqual(
    h.snapshot().menuIndex,
    HOWTO_INDEX,
    "the highlight rests on the how-to entry before the press",
  );

  await h.tap(CONFIRM_KEY);
  // Before the assertion, so a check that fails still leaves the picture of the
  // screen the press actually arrived at.
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    `confirming the highlighted ${HOWTO_ITEM} entry moving the game to the ` +
      "howto screen (specs/ui.md)",
  );
});
