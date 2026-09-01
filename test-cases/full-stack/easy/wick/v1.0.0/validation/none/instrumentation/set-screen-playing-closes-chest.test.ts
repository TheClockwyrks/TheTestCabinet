// Wick — instrumentation/set-screen-playing-closes-chest: `setScreen("playing")`
// on `chest` returns to `playing` with `chestResult` `null` and the run
// otherwise untouched.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `playing | chest` row: "Closes the overlay exactly as `confirm` does:
// `chestResult` becomes `null`." specs/progression.md: "`confirm` closes it,
// setting `chestResult` to `null` and `screen` to `playing`."
//
// WHY THE WORLD IS POSED AS IT IS. The overlay is reached by the real
// collection path, a chest at the lamplighter's center and the tick that
// collects it, on an isolated night so the tick does nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  isolate,
  openChest,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes the chest overlay and leaves the run otherwise untouched", async () => {
  await isolate(h);
  const chest = await openChest(h);
  assertEqual(chest.screen, "chest", "the screen the collected chest opened");
  assertNotNull(chest.run.chestResult, "chestResult on the open overlay");

  const closed = await poseScreen(h, "playing");
  await captureStill(h, "closed");

  assertEqual(closed.screen, "playing", "the screen after setScreen('playing')");
  assertNull(closed.run.chestResult, "chestResult after the overlay closed");
  const rest = documentedRun(closed.run);
  rest.chestResult = chest.run.chestResult;
  assertDeepEqual(
    rest,
    documentedRun(chest.run),
    "the run beside chestResult, across the close",
  );
});
