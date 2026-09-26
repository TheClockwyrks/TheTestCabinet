// Spectra — controls/confirm-space: `Space` confirms the highlighted title-menu item.
//
// THE RULE. `specs/controls.md` binds the `confirm` action — "Takes the highlighted
// menu item." — to `Enter` and `Space`, reads it as a press EDGE, and lists it among
// the actions the `title` screen reads. `specs/ui.md` gives the title menu its two
// entries, the mode entry then `HOW TO PLAY`, and says what each leads to: the mode
// entry opens a run, and `HOW TO PLAY` "Moves to `howto`". This point decides one
// half of the binding: that the physical key `Space` is one of the keys which drives
// `confirm`. `controls/confirm-enter` decides `Enter`.
//
// ONE KEY, TWO ACTIONS, AND THE SCREEN DECIDES. `Space` drives `confirm` AND `a`,
// and `specs/controls.md` settles the collision with its table of what each screen
// reads: the `title` screen reads `confirm` and does not read `a`. Both actions are
// registered against the key and the build reads both every frame, so the key really
// does raise the ambiguity, and the title must resolve it as the confirm — which is
// what pressing the physical key, rather than raising an action, puts in front of
// the build. `controls/fire-space` decides the same key's other reading, in a live
// wave.
//
// WHY THE SECOND ITEM IS THE ONE HIGHLIGHTED. Because it is the distinguishing
// value. `confirm` takes THE HIGHLIGHTED item, and the highlight rests on the first
// item on arrival (`specs/ui.md`), so a build whose confirm ignores the highlight
// and always opens the mode is indistinguishable from a correct one at index 0.
// Posed at index 1, every wrong model reads as a different screen: a key wired to
// nothing leaves the game on `title`, a confirm that ignores the highlight opens
// `stageIntro`, and only a confirm that takes the highlighted item opens `howto`.
// `setMenuIndex` is what `specs/instrumentation.md` provides for posing exactly
// this, so the highlight is placed directly rather than walked to with the menu
// keys — whose own points are `controls/menu-up-*` and `controls/menu-down-*`, and
// which must not be able to fail this one.
//
// THE INDEX IS THE SPECIFICATION'S, NOT THE BUILD'S. `HOWTO_INDEX` is 1 because
// `specs/ui.md` puts `HOW TO PLAY` second in a two-entry menu, and it is written out
// here rather than looked up in the build's own `TITLE_ITEMS`: a build that shipped
// a different menu would otherwise agree with itself and pass. What the entries say
// is `screens/title-menu-items`'s verdict.
//
// WHAT IS NOT ASSERTED. What the how-to screen contains is
// `screens/howto-content`'s; that the how-to entry is reachable at all is
// `screens/howto-reachable`'s; what confirming the MODE entry opens is
// `screens/start-enters-stage-intro`'s. This point reads the screen the press
// arrived at and nothing else.
//
// THE KEY IS TAPPED, AND IT IS A REAL ONE. `specs/controls.md` reads `confirm` as an
// edge, so a conforming build resolves it through the engine's `pressed`: `tap`
// presses the key, releases it, and runs the one frame that delivers the armed
// edge, which is exactly what the engine's input frame carries. The event is a
// `KeyboardEvent`-shaped one dispatched at the engine's own event target, which the
// engine resolves exactly as it resolves a player's key. The code below is the
// LITERAL `specs/controls.md` states rather than `BINDINGS.confirm[…]`: that table
// is the build's own copy of the very thing this point decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key `specs/controls.md` binds the `confirm` action to, written out as it states it. */
const KEY = "Space";

/**
 * Which entry of the title menu is highlighted before the press.
 *
 * The second, which `specs/ui.md` fixes as `HOW TO PLAY` — the one entry of the two
 * whose destination is not the mode's, so a confirm that ignores the highlight
 * lands somewhere else.
 */
const HOWTO_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the highlighted title-menu item when Space is pressed", async () => {
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "title",
    "the game opens on the title screen",
  );

  h.debug.setMenuIndex(HOWTO_INDEX);
  await h.advance(1);
  assertEqual(
    h.snapshot().menuIndex,
    HOWTO_INDEX,
    "the highlighted item posed before the press, which specs/ui.md fixes as HOW TO PLAY",
  );

  await h.tap(KEY);
  // Before the assertion, so a check that fails still leaves the picture of the
  // screen the press actually arrived at.
  captureStill(h, "confirmed");

  assertEqual(
    h.snapshot().screen,
    "howto",
    `the screen one frame after Space was pressed with the second title item ` +
      "highlighted, which specs/ui.md says moves to howto",
  );
});
