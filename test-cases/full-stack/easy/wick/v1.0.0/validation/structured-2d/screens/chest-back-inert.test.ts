// Wick — screens/chest-back-inert: `back` does nothing on the chest overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`chest`": "`up`,
// `down`, `back`, and `pause` do nothing here", and the overlay "shows
// `CHEST_TEXT` ... and the result in `chestResult`". `specs/controls.md`
// gives the `chest` row `confirm` and `mute` alone, and "An action a row omits
// does nothing on that screen"; `back` is bound to `Escape`.
//
// WHAT IS READ. The screen AND the result: `specs/progression.md` says
// closing the overlay is what sets "`chestResult` to `null`", so a build that
// let `back` close it would be caught by either reading, and a build that
// cleared the result without leaving the screen by the second.
//
// THE DRIVE. An isolated `playing` run holding nothing, every driver switch
// off; a chest posed at the lamplighter's own centre and the one tick that
// collects it; then one real `Escape`.
//
// THE TOLERANCE. None: a screen name and a result compared field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
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

it("leaves the chest overlay and its result untouched by Escape", async () => {
  isolate(h);
  const overlay = await openChest(h);
  assertEqual(overlay.screen, "chest", "the screen the press is made on");
  assertNotNull(overlay.run.chestResult, "the result the overlay opened with");

  const after = await tap(h, "Escape");
  captureStill(h, "inert");

  assertEqual(after.screen, "chest", "the screen after Escape");
  assertDeepEqual(
    after.run.chestResult,
    overlay.run.chestResult,
    "chestResult after Escape",
  );
});
