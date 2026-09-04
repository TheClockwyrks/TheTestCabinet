// Facet — keyboard/pause-key: the `pause` action, fired from a live board with
// the key specs/controls.md binds it to, opens the pause menu.
//
// TWO SPEC SENTENCES MEET HERE, and the point is worth having because either
// one can be honored without the other. specs/controls.md's effect table says
// `pause` "Enters and leaves `paused` from `playing`" and its binding table
// gives `pause` two keys, of which `KeyP` is one — so a build that implemented
// the screen but never bound the key, or bound the key but sent it somewhere
// else, has a pause menu a player cannot reach mid-round. specs/ui.md then fixes
// what arriving looks like: `paused` is "reached from `playing` with the `pause`
// action", and "`menuIndex` is `0` on arriving."
//
// ONE OF THE TWO KEYS, AND THE OTHER IS ITS OWN POINT. "Each key listed for an
// action fires that action on its own", so `KeyP` has to raise the menu with no
// help from the key beside it in the table. `Escape` is `keyboard/pause-escape`'s,
// and a build that bound one and missed the other owes exactly one of the two.
//
// SO THE CHECK IS THE PLAYER'S OWN GESTURE, not a pose. `setScreen("paused")`
// arranges the same screen, and driving that would prove the screen exists while
// saying nothing about the key — which is half the point. The key is pressed through the real input path instead, and
// the frame that press runs is what the screen is read after.
//
// WHAT IT DOES NOT DECIDE. That `pause` LEAVES the menu again is
// `screens/pause-leaves-paused`, that nothing advances while it is up is
// `screens/paused-freezes`, and the menu's copy and items are
// `screens/paused-copy`. This point is the arrival: the screen, and the
// highlight it arrives with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { quietRowsWithEscape } from "../board";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * `KeyP`, the second of the two keys specs/controls.md binds `pause` to.
 *
 * Read out of the table rather than written down, so the key this check presses
 * is the key the case states. The first entry is `Escape`, which
 * `keyboard/pause-escape` presses; the two are separate points because either
 * key fires the action on its own.
 */
const PAUSE_KEY = BINDINGS.pause[1];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it(`opens the pause menu when ${PAUSE_KEY} is pressed on a live board`, async () => {
  // A posed board puts the game on `playing` with a settled position, which is
  // the screen the effect table says `pause` is entered FROM. The filler carries
  // a spare legal swap, so the round cannot end out from under the check.
  loadBoard(h, quietRowsWithEscape([]));

  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the key is pressed on");

  // A real press of the bound key, delivered as an edge one frame reads —
  // never `setScreen`, which would arrange the screen without saying anything
  // about the binding.
  await h.tap(PAUSE_KEY);

  // The frame the press ran is the first frame of the pause menu, so the
  // picture kept here is the screen the key opened.
  captureStill(h, "paused");

  const after = h.snapshot();
  assertEqual(after.screen, "paused", `the screen after ${PAUSE_KEY}`);
  assertEqual(after.menuIndex, 0, "the highlighted item on arriving at paused");
});
