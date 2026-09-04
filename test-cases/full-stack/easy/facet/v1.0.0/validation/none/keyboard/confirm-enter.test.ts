// Facet — keyboard/confirm-enter: the `confirm` action, fired with this key alone,
// takes the highlighted menu item.
//
// TWO SPEC SENTENCES MEET HERE. specs/controls.md's effect table says `confirm`
// "Chooses the highlighted menu item", and its binding table gives the action
// `Enter` and `Space`. specs/controls.md then fixes what having two keys means:
// "Each key listed for an action fires that action on its own, so either key of
// a two-key action is enough."
//
// SO EACH KEY IS ITS OWN POINT, exactly as `pause`'s two are. `Space` is `keyboard/confirm-space`'s,
// and a build that wired one of them and missed the other owes exactly one of
// the two rather than both or neither. Nothing else in the case presses this key
// on its own: every other check reaches a menu item through the harness's one
// helper, which presses a single binding.
//
// THE ITEM IT TAKES, AND WHY THAT ONE. The title's `HOW TO PLAY` is the entry
// with the plainest effect specs/ui.md gives — "Sets `screen = howto`" — and it
// is not the entry `reset()` leaves highlighted, so the highlight is posed onto
// it with `setMenuIndex`, which specs/instrumentation.md says takes no item. A
// screen that changed is then the key having taken the item, and not the game
// having been left where it started.
//
// WHAT IT DOES NOT DECIDE. That the `howto` screen carries what specs/ui.md says
// it carries is `screens/howto-copy`'s point, and that the highlight moves at
// all is the `screens` menu points'. This point is the key reaching the action.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * `Enter`, the first of the two keys specs/controls.md binds `confirm` to.
 *
 * Read out of the table rather than written down, so the key this check presses
 * is the key the case states.
 */
const CONFIRM_KEY = BINDINGS.confirm[0];

/** Where `HOW TO PLAY` sits on the title menu, from specs/ui.md's `TITLE_ITEMS`. */
const HOW_TO_PLAY_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`takes the highlighted menu item when ${CONFIRM_KEY} is pressed`, async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(HOW_TO_PLAY_INDEX);

  const before = await h.snapshot();
  assertEqual(before.screen, "title", "the screen the key is pressed on");
  assertEqual(
    before.menuIndex,
    HOW_TO_PLAY_INDEX,
    "the item posed as highlighted",
  );

  // A real press of the bound key, delivered as an edge one frame reads.
  await h.tap(CONFIRM_KEY);

  // The frame the press ran is the first frame of the screen the item opened.
  await captureStill(h, "taken");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    `the screen after ${CONFIRM_KEY}`,
  );
});
