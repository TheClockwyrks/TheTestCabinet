// Wick — screens/levelup-pause-inert: `pause` does nothing on the level-up
// overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`":
// "`back` and `pause` do nothing here." `specs/ui.md`, "Menu navigation",
// adds that "`pause` is read on `playing` and `paused` alone", and
// `specs/controls.md` gives the `levelup` row `up`, `down`, `confirm`, and
// `mute` alone; `pause` is bound to `KeyP`.
//
// THE DRIVE. An isolated `playing` run holding nothing, the overlay opened by
// one `playing` tick, then one real `ArrowDown` so the highlight sits
// somewhere an arrival would not have put it, then one real `KeyP`. The
// screen, the offers, and the highlight are all read.
//
// THE TOLERANCE. None: a screen name, a list of ids, and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";

/** Where the highlight is moved before the press. */
const HIGHLIGHTED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the overlay, its offers, and its highlight untouched by KeyP", async () => {
  isolate(h);
  await openLevelUp(h, 1);
  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.screen, "levelup", "the screen the press is made on");
  assertEqual(posed.menuIndex, HIGHLIGHTED, "menuIndex before the press");

  const after = await tap(h, "KeyP");
  captureStill(h, "inert");

  assertEqual(after.screen, "levelup", "the screen after KeyP");
  assertEqual(after.menuIndex, HIGHLIGHTED, "menuIndex after KeyP");
  assertDeepEqual(after.run.offers, posed.run.offers, "the offers after KeyP");
  assertEqual(
    after.run.pendingLevelUps,
    posed.run.pendingLevelUps,
    "the level-ups pending after KeyP",
  );
});
