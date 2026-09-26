// Spectra — controls/menu-down-arrow: `ArrowDown` moves the title menu's selection
// down.
//
// THE RULE. `specs/controls.md` binds the `down` action to `ArrowDown` and
// `KeyS`, reads it as a press edge, and lists it among the actions the `title`
// screen reads. Its Menus section says every menu is vertical, that `up` and
// `down` "move the highlight by one item and wrap at both ends", and that
// moving down from the LAST item highlights the first. `specs/ui.md` says the title's
// highlight rests on the first item on arriving there, and `specs/ui.md` and
// `specs/mode.md` together give `TITLE_ITEMS` its two entries: the mode entry,
// then `HOW TO PLAY`. This point decides one half of the binding: that the
// physical key `ArrowDown` is one of the keys which drives `down`. `controls/menu-down-s`
// decides `KeyS`.
//
// THE UNAMBIGUOUS HALF OF THE BINDING. `ArrowDown` drives `down` and nothing else,
// where the other keys the title menu answers to are shared with the cannon. What
// moves the highlight here can therefore only be the `down` action.
//
// WHAT A TWO-ITEM MENU CAN AND CANNOT DECIDE. `TITLE_ITEMS` has exactly two
// entries, so with the wrap the specification requires, `up` and `down` are the
// same permutation of the highlight — from either index, both land on the other.
// This suite therefore does not claim to tell `down` apart from its opposite on
// this menu; no check could, and one that tried would be asserting something
// `specs/ui.md` does not state. What it does pin is the whole of what IS stated
// for this key on this screen, over a full cycle: the press steps from the first item to the second,
// and the second press wraps from the last item back to the first. Every wrong model
// reads as a different index — a key wired to nothing leaves the highlight at 0, a
// build that clamps instead of wrapping leaves it at 0 on the second press, a
// build that moves by two leaves it at 0 on the second, and a build that navigates
// away leaves the title screen altogether.
//
// WHAT IS NOT ASSERTED. Which item is DRAWN as highlighted is
// `screens/title-menu-selection`'; what the menu's entries say is
// `screens/title-menu-items`'; that a highlight move sounds its cue is `audio`'s.
// This point reads `menuIndex` off the snapshot and nothing else.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline — so what
// reaches the build is a browser-trusted DOM key event on the real page, and the
// frame between the down and the up makes the press visible to a build that
// compares held state between frames as well as to one that latches the edge in
// its handler. Under this engine there is no action layer between the page and the
// game (`specs/instrumentation.md` gives the surface no keyboard operation at
// all), so the whole path from a physical key to a moved highlight is the build's.
//
// THE SCREEN IS THE ONE A FRESH PAGE OPENS ON. `createHarness` takes the game off
// the wall clock and `reset`s it, which `specs/instrumentation.md` says restores
// the screen to `title` and `menuIndex` to `0`. Nothing else is posed: this point
// wants the menu exactly as a player first meets it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { titleItems } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** Where `specs/ui.md` rests the title's highlight on arrival. */
const FIRST_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the title menu's selection with ArrowDown, wrapping at the end", async () => {
  await h.advance(1);
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title screen");
  assertEqual(opened.menuIndex, FIRST_INDEX, "with its first item highlighted");

  // The menu's length is the mode's, since `TITLE_ITEMS` opens with the entry
  // `specs/mode.md` names for the mode this build ships. One suite serves both
  // variants, so it is read off the snapshot rather than compiled in.
  const lastIndex = titleItems(opened.mode).length - 1;
  assertEqual(
    lastIndex,
    1,
    "the title menu holds the two items TITLE_ITEMS lists",
  );

  await h.tap("ArrowDown");
  await captureStill(h, "moved");
  assertEqual(
    (await h.snapshot()).menuIndex,
    FIRST_INDEX + 1,
    "The Down arrow steps from the first item to the second",
  );

  await h.tap("ArrowDown");
  const cycled = await h.snapshot();
  assertEqual(
    cycled.menuIndex,
    FIRST_INDEX,
    "and wraps from the last item back to the first",
  );
  assertEqual(
    cycled.screen,
    "title",
    "with the game still on the title screen throughout",
  );
});
