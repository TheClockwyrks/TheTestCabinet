// Spectra — controls/menu-up-w: `KeyW` moves the title menu's selection up.
//
// THE RULE. `specs/controls.md` binds the `up` action to `KeyW` and
// `ArrowUp`, reads it as a press EDGE, and lists it among the actions the `title`
// screen reads. Its Menus section says every menu is vertical, that `up` and `down`
// "move the highlight by one item and wrap at both ends". `specs/ui.md` says the
// title's highlight rests on the first item on arriving there, and gives
// `TITLE_ITEMS` exactly two entries — "The mode entry `specs/mode.md` names, then
// `HOW TO PLAY`, in that order". This point decides one half of the binding: that
// the physical key `KeyW` is one of the keys which drives `up`.
// `controls/menu-up-arrow` decides `ArrowUp`.
//
// ONE KEY, TWO ACTIONS, AND THE SCREEN DECIDES. `KeyW` drives `up` AND `a`, and
// `specs/controls.md` settles the collision with its table of what each screen
// reads: the `title` screen reads `up` and does not read `a`. Both actions are
// registered against the key, so the key really does raise the ambiguity — pressing
// it rather than raising an action is what puts that in front of the build.
// `controls/fire-w` decides the same key's other reading, in a live wave.
//
// WHAT A TWO-ITEM MENU CAN AND CANNOT DECIDE. `TITLE_ITEMS` has exactly two
// entries, so with the wrap the specification requires, `up` and `down` are the
// same permutation of the highlight — from either index, both land on the other.
// This suite therefore does not claim to tell `up` apart from its opposite on
// this menu; no check could, and one that tried would be asserting something
// `specs/ui.md` does not state. What it does pin is the whole of what IS stated for
// this key on this screen, over a full cycle: the press wraps from the first item to the last, and the second press steps from the last item back to the first.
// Every wrong model reads as a different index — a key wired to nothing leaves the
// highlight at 0 throughout, a build that clamps instead of wrapping stalls at an
// end, a build that moves by two never leaves 0, and a build that navigates away
// leaves the title screen altogether.
//
// WHAT IS NOT ASSERTED. Which item is DRAWN as highlighted is
// `screens/title-menu-selection`'s; what the menu's entries say is
// `screens/title-menu-items`'s; that a highlight move sounds its cue is
// `audio/menu`'s. This point reads `menuIndex` off the snapshot and nothing else.
//
// THE MENU'S LENGTH IS THE SPECIFICATION'S, NOT THE BUILD'S. The indices below come
// from `specs/ui.md`'s two-entry `TITLE_ITEMS` rather than from the build's own
// `TITLE_ITEMS` array. A build that shipped a third entry would agree with itself
// and pass a check that read its own table; it fails this one, and
// `screens/title-menu-items` names the fault.
//
// THE KEY IS TAPPED, AND IT IS A REAL ONE. `specs/controls.md` reads `up` as an
// edge, so a conforming build resolves it through the engine's `pressed`: `tap`
// presses the key, releases it, and runs the one frame that delivers the armed
// edge, which is exactly what the engine's input frame carries. The event is a
// `KeyboardEvent`-shaped one dispatched at the engine's own event target, which the
// engine resolves exactly as it resolves a player's key. The code below is the
// LITERAL `specs/controls.md` states rather than `BINDINGS.up[…]`: that table is
// the build's own copy of the very thing this point decides.
//
// THE SCREEN IS THE ONE A FRESH PAGE OPENS ON. The harness builds the engine and
// initializes the build, and `specs/ui.md` makes `title` the screen the game opens
// on with its highlight on the first item. Nothing is posed: this point wants the
// menu exactly as a player first meets it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key `specs/controls.md` binds the `up` action to, written out as it states it. */
const KEY = "KeyW";

/** Where `specs/ui.md` rests the title's highlight on arrival. */
const FIRST_INDEX = 0;

/**
 * The last index of the title menu.
 *
 * `specs/ui.md` gives `TITLE_ITEMS` two entries — the mode entry, then
 * `HOW TO PLAY` — so the last one is index 1.
 */
const LAST_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title menu's selection with W, wrapping at the end", async () => {
  await h.advance(1);
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title screen");
  assertEqual(opened.menuIndex, FIRST_INDEX, "with its first item highlighted");

  await h.tap(KEY);
  // Before the assertions, so a check that fails still leaves the picture of the
  // menu the first press left behind.
  captureStill(h, "moved");
  assertEqual(
    h.snapshot().menuIndex,
    LAST_INDEX,
    `the highlighted item after one W from index ${String(FIRST_INDEX)} ` +
      "of a two-item menu that wraps at both ends (specs/controls.md, specs/ui.md)",
  );

  await h.tap(KEY);
  const cycled = h.snapshot();
  assertEqual(
    cycled.menuIndex,
    FIRST_INDEX,
    `the highlighted item after a second W, which closes the cycle back ` +
      "on the first item (specs/controls.md, specs/ui.md)",
  );
  assertEqual(
    cycled.screen,
    "title",
    "the screen the presses were made on, which a highlight move never leaves",
  );
});
