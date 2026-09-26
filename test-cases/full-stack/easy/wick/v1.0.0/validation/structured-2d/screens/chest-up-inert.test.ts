// Wick — screens/chest-up-inert: `up` does nothing on the chest overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`chest`": "`up`,
// `down`, `back`, and `pause` do nothing here." `specs/controls.md`, "What
// each screen reads", gives the `chest` row `confirm` and `mute` alone, and
// "An action a row omits does nothing on that screen"; the overlay carries no
// menu, so `specs/ui.md`'s "on a screen with no highlight it stays `0`" is
// what `menuIndex` must read after the press. The other arrow is
// `screens/chest-down-inert`'s.
//
// THE DRIVE. An isolated `playing` run holding nothing, every driver switch
// off; a chest posed at the lamplighter's own centre and the one tick that
// collects it; then one real `ArrowUp`, read back where it was made.
//
// THE TOLERANCE. None: a screen name and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stays on the chest overlay with menuIndex 0 under up", async () => {
  isolate(h);
  const overlay = await openChest(h);
  assertEqual(overlay.screen, "chest", "the screen the press is made on");
  assertEqual(overlay.menuIndex, 0, "menuIndex on opening the overlay");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "inert");

  assertEqual(after.screen, "chest", "the screen after ArrowUp");
  assertEqual(after.menuIndex, 0, "menuIndex after ArrowUp");
});
