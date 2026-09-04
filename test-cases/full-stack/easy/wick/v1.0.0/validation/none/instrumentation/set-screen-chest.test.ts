// Wick — instrumentation/set-screen-chest: `setScreen("chest")` from `playing`
// stands the game on `chest` with `menuIndex` `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Sets `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// `chest` is one of the nine `Screen` values, so the pose reaches it like any
// other; what a collected chest does instead — the result applied and
// `chestResult` filled — is the chest overlay's own points, reached through
// "`spawnPickup("chest", x, y)` at the lamplighter's center and one tick, which
// is the real collection path".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, so the screen the reading
// finds is the pose's and no tick could have opened an overlay of its own. The
// run is left with no chest result, so a build that reached `chest` by running
// its collection path instead of setting the field is read on that.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
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

it("stands the game on the chest screen", async () => {
  const playing = await isolate(h);
  assertEqual(playing.screen, "playing", "the screen the call is made from");
  assertNull(playing.run.chestResult, "chestResult before the call");

  const chest = await poseScreen(h, "chest");
  await captureStill(h, "chest");

  assertEqual(chest.screen, "chest", "the screen after setScreen('chest')");
  assertEqual(chest.menuIndex, 0, "menuIndex on entering chest");
  assertNull(chest.run.chestResult, "chestResult after the call");
});
