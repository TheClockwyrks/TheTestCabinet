// screens/chest-pause-inert — `pause` does nothing on the chest overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`chest`"): "`up`, `down`,
// `back`, and `pause` do nothing here." specs/ui.md ("Menu navigation"):
// "`pause` is read on `playing` and `paused` alone". specs/controls.md ("What
// each screen reads"), the `chest` row: "`confirm` closes the overlay; `mute`",
// and "An action a row omits does nothing on that screen."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an empty loadout, so
// the chest falls through to the heal, and the chest is reached the real way.
// The result is read before and after the press, because a build that let
// `KeyP` through would either pause the run under the overlay or close it, and
// both show up as a screen or a result that moved.
//
// THE TOLERANCE. None: a screen name, an index and a result's kind are exact
// comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressPause,
  type Harness,
} from "../harness";
import { assertHighlight, chestResultOf, night, openHealChest } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the chest overlay standing with its result after KeyP", async () => {
  await night(h);
  const opened = await openHealChest(h);
  const before = chestResultOf(opened, "the collected chest");

  const after = await pressPause(h);
  await captureStill(h, "inert");

  assertHighlight(after, "chest", 0, "after KeyP on the chest overlay");
  assertEqual(
    chestResultOf(after, "KeyP on the chest overlay").kind,
    before.kind,
    "the result the overlay reports after KeyP",
  );
});
