// instrumentation/set-screen-playing-closes-chest — `setScreen('playing')` on
// chest returns to playing with chestResult null and the run otherwise
// untouched, exactly as `confirm` on the overlay does.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `playing` from `chest`: "Closes the overlay exactly as `confirm` does:
// `chestResult` becomes `null`". specs/progression.md, "The chest overlay":
// "`confirm` closes it, setting `chestResult` to `null` and `screen` to
// `playing`".
//
// THE POSE. An isolated run with a chest under the lamplighter and the tick
// that collects it, "the real collection path". Then the pose, and `run` is
// compared against the overlay's reading with `chestResult` alone allowed to
// change, to null.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("closes the chest overlay and clears its result", async () => {
  isolate(h);
  const chest = await openChest(h);
  assertEqual(chest.screen, "chest", "the overlay opened by the collection");
  assertNotNull(chest.run.chestResult, "chestResult on the overlay");

  h.debug.setScreen("playing");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "closed");

  assertEqual(s.screen, "playing", "the screen after the pose");
  assertEqual(s.run.chestResult, null, "chestResult after the close");
  assertDeepEqual(
    { ...s.run, chestResult: null },
    { ...chest.run, chestResult: null },
    "run, but for chestResult, across the close",
  );
});
