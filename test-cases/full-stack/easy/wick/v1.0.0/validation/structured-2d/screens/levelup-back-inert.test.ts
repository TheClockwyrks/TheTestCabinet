// Wick — screens/levelup-back-inert: `back` does nothing on the level-up
// overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`":
// "`back` and `pause` do nothing here." `specs/controls.md`, "What each screen
// reads", gives the `levelup` row `up`, `down`, `confirm`, and `mute` alone,
// and "An action a row omits does nothing on that screen"; `back` is bound to
// `Escape`.
//
// THE DRIVE. An isolated `playing` run holding nothing, the overlay opened by
// one `playing` tick, then one real `ArrowDown` so the highlight sits
// somewhere an arrival would not have put it — a build that treated `back` as
// a return to `playing` and back again would show up in `menuIndex` as much as
// in `screen`. Then one real `Escape`, and the screen, the offers, and the
// highlight are all read.
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

it("leaves the overlay, its offers, and its highlight untouched by Escape", async () => {
  isolate(h);
  await openLevelUp(h, 1);
  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.screen, "levelup", "the screen the press is made on");
  assertEqual(posed.menuIndex, HIGHLIGHTED, "menuIndex before the press");

  const after = await tap(h, "Escape");
  captureStill(h, "inert");

  assertEqual(after.screen, "levelup", "the screen after Escape");
  assertEqual(after.menuIndex, HIGHLIGHTED, "menuIndex after Escape");
  assertDeepEqual(
    after.run.offers,
    posed.run.offers,
    "the offers after Escape",
  );
  assertEqual(
    after.run.pendingLevelUps,
    posed.run.pendingLevelUps,
    "the level-ups pending after Escape",
  );
});
