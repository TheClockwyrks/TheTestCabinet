// Wick — instrumentation/set-screen-keeps-chest-result: `setScreen("playing")`
// on `chest` leaves `chestResult` standing.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Nothing else changes: the run, the loadout, `offers`, `nextOffers`,
// `chestResult`, `pendingLevelUps`, every posed outcome, `simTime`, and the driver
// switches all stand exactly as they were", and "The pose sets the screen and
// nothing else". Closing the overlay is `confirm`'s, as specs/progression.md
// states — "`confirm` closes it, setting `chestResult` to `null` and `screen`
// to `playing`" — which `screens/chest-confirm-closes` decides.
//
// WHY THE WORLD IS POSED AS IT IS. The overlay is reached by the real
// collection path, a chest at the lamplighter's center and the tick that
// collects it, on an isolated night so the tick does nothing else. A result is
// the one field of the run only an overlay ever fills, so it is the field a
// build that implemented this pose as the real transition clears.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
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

it("leaves the chest result standing across the pose", async () => {
  await isolate(h);
  const chest = await openChest(h);
  assertEqual(chest.screen, "chest", "the screen the collected chest opened");
  assertNotNull(chest.run.chestResult, "chestResult on the open overlay");

  const posed = await poseScreen(h, "playing");
  await captureStill(h, "kept");

  assertEqual(posed.screen, "playing", "the screen after setScreen('playing')");
  assertDeepEqual(
    posed.run.chestResult,
    chest.run.chestResult,
    "chestResult across the pose",
  );
  assertDeepEqual(
    documentedRun(posed.run),
    documentedRun(chest.run),
    "the run across the pose",
  );
});
