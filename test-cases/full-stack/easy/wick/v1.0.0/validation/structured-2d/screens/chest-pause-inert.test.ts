// Wick — screens/chest-pause-inert: `pause` does nothing on the chest overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`chest`": "`up`,
// `down`, `back`, and `pause` do nothing here." `specs/ui.md`, "Menu
// navigation", adds that "`pause` is read on `playing` and `paused` alone",
// and `specs/controls.md` gives the `chest` row `confirm` and `mute` alone;
// `pause` is bound to `KeyP`.
//
// WHAT IS READ. The screen AND the result, for the same reason `back`'s point
// reads both: `specs/progression.md` ties clearing `chestResult` to closing
// the overlay, so either half moving is a failure.
//
// THE DRIVE. An isolated `playing` run holding nothing, every driver switch
// off; a chest posed at the lamplighter's own centre and the one tick that
// collects it; then one real `KeyP`.
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

it("leaves the chest overlay and its result untouched by KeyP", async () => {
  isolate(h);
  const overlay = await openChest(h);
  assertEqual(overlay.screen, "chest", "the screen the press is made on");
  assertNotNull(overlay.run.chestResult, "the result the overlay opened with");

  const after = await tap(h, "KeyP");
  captureStill(h, "inert");

  assertEqual(after.screen, "chest", "the screen after KeyP");
  assertDeepEqual(
    after.run.chestResult,
    overlay.run.chestResult,
    "chestResult after KeyP",
  );
});
