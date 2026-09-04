// Wick — instrumentation/set-screen-playing-resumes: `setScreen('playing')` on
// `paused` returns to `playing` with the run untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `playing` from `paused`: "Resumes exactly as `pause`
// on `paused` does; the run is untouched", with `menuIndex` `0`.
//
// THE POSE. An isolated run with one of everything on the field and its
// timers mid-count (a bolt, a puddle, a moth with a contact cooldown, a held
// weapon with a cooldown, a spawn timer, a moved and hurt lamplighter), paused
// through the surface, then the pose. The whole `run` before is compared with
// the whole `run` after, structurally.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placeProjectile,
  placePuddle,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing with every entity, timer, and figure as the pause left it", async () => {
  isolate(h);
  h.debug.setPlayerPosition(120, -40);
  h.debug.setHp(55);
  h.debug.setTick(700);
  h.debug.setSpawnTimer(0.7);
  const slot = holdWeapon(h, "ember", 3);
  h.debug.setWeaponCooldown(slot, 0.4);
  const moth = placeEnemy(h, "moth", 300, 0);
  h.debug.setEnemyContactCooldown(moth, 0.3);
  placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  placePuddle(h, "oil-splash", 50, 50);
  placeGem(h, "large", 400, 100);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "screen before the pose");

  h.debug.setScreen("playing");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "resumed");

  assertEqual(after.screen, "playing", "screen after setScreen('playing')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('playing')");
  assertDeepEqual(
    after.run,
    paused.run,
    "run after resuming, against the paused run",
  );
});
