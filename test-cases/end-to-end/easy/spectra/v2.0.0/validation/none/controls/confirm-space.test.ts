// Spectra — controls/confirm-space: `Space` confirms the highlighted
// title-menu item.
//
// THE RULE. `specs/controls.md` binds the `confirm` action — "Takes the
// highlighted menu item." — to `Enter` and `Space`, reads it as a press edge, and
// lists it among the actions the `title` screen reads. `specs/ui.md` gives the
// title menu its two entries, the mode entry then `HOW TO PLAY`, and says what
// each leads to: the mode entry opens a run at `stageIntro`, and `HOW TO PLAY`
// moves to `howto`. This point decides one half of the binding: that the physical
// key `Space` is one of the keys which drives `confirm`. `controls/confirm-enter` decides the
// other.
//
// ONE KEY, TWO ACTIONS, AND THE SCREEN DECIDES. `Space` drives `confirm` AND
// `a`, and `specs/controls.md` settles the collision with its table of what each
// screen reads: the `title` screen reads `confirm` and does not read `a`. A real
// `Space` key event raises both readings at once, and the title must resolve it as
// the confirm — which is what pressing the physical key, rather than raising an
// action, puts in front of the build. `controls/fire-space` decides the same key's
// other reading, in a live wave.
//
// WHY THE SECOND ITEM IS THE ONE HIGHLIGHTED. Because it is the distinguishing
// value. `confirm` takes THE HIGHLIGHTED item, and the highlight rests on the
// first item on arrival (`specs/ui.md`), so a build whose confirm ignores the
// highlight and always opens the mode is indistinguishable from a correct one at
// index 0. Posed at index 1, each wrong model reads as a different screen: a key
// wired to nothing leaves the game on `title`, a confirm that ignores the
// highlight opens `stageIntro`, and only a confirm that takes the highlighted item
// opens `howto`. `setMenuIndex` is what `specs/instrumentation.md` provides for
// posing exactly this, so the highlight is placed directly rather than walked to
// with the menu keys — whose own points are `controls/menu-up-*` and
// `controls/menu-down-*`, and which must not be able to fail this one.
//
// WHAT IS NOT ASSERTED. What the how-to screen contains is
// `screens/howto-content`'; that the how-to entry is reachable at all is
// `screens/howto-reachable`'; what confirming the MODE entry opens is
// `screens/start-enters-stage-intro`'. This point reads the screen the press
// arrived at and nothing else.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline — so what
// reaches the build is a browser-trusted DOM key event on the real page, and the
// frame between the down and the up makes the press visible to a build that
// compares held state between frames as well as to one that latches the edge in
// its handler. Under this engine there is no action layer between the page and the
// game (`specs/instrumentation.md` gives the surface no keyboard operation at
// all), so the whole path from a physical key to an opened screen is the build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_ITEM, titleItems } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** Which entry of `TITLE_ITEMS` is highlighted before the press. */
const HOWTO_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the highlighted title-menu item when Space is pressed", async () => {
  await h.advance(1);
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title screen");

  // `TITLE_ITEMS` opens with the entry `specs/mode.md` names for the mode this
  // build ships, so the menu is read off the snapshot rather than compiled in; the
  // second entry is `HOW TO PLAY` under either mode.
  const items = titleItems(opened.mode);
  assertEqual(
    items[HOWTO_INDEX],
    HOWTO_ITEM,
    "the second title item is HOW TO PLAY",
  );

  await h.debug.setMenuIndex(HOWTO_INDEX);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).menuIndex,
    HOWTO_INDEX,
    "the highlight rests on the second item before the press",
  );

  await h.tap("Space");
  await captureStill(h, "confirmed");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "Space took the highlighted HOW TO PLAY item, which specs/ui.md says opens the how-to screen",
  );
});
