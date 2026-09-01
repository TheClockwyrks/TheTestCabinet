// Wick — instrumentation/set-screen-playing-resumes: `setScreen("playing")` on
// `paused` returns to `playing` with the run untouched.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `playing | paused` row: "Resumes exactly as `pause` on `paused` does; the
// run is untouched." The comparison is exact equality of the documented run
// across the call.
//
// WHY THE WORLD IS POSED AS IT IS. The paused run holds one entity of every
// kind, a clock, a spawn timer, a hurt lamplighter, and a weapon with a timer
// counting, so a resume that rebuilt or restarted anything is caught on that
// field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
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

it("resumes the paused run untouched", async () => {
  await isolate(h);
  await h.debug.setTick(123);
  await h.debug.setSpawnTimer(0.4);
  await h.debug.setHp(55);
  const slot = await holdWeapon(h, "ember", 2);
  await h.debug.setWeaponCooldown(slot, 0.7);
  await placeEnemy(h, "moth", 200, 0);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placePuddle(h, "oil-splash", 50, 50);
  await placeGem(h, "medium", -200, 0);
  await placePickup(h, "bread", 0, -200);
  const paused = await poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the call is made from");

  const resumed = await poseScreen(h, "playing");
  await captureStill(h, "resumed");

  assertEqual(
    resumed.screen,
    "playing",
    "the screen after setScreen('playing')",
  );
  assertEqual(resumed.menuIndex, 0, "menuIndex after resuming");
  assertDeepEqual(
    documentedRun(resumed.run),
    documentedRun(paused.run),
    "the run across the resume",
  );
});
