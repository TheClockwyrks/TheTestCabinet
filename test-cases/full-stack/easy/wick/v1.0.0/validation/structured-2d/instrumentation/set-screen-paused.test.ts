// Wick — instrumentation/set-screen-paused: `setScreen('paused')` on `playing`
// enters `paused` with `menuIndex` 0, the run untouched, and the accumulator 0.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `paused` from `playing`: "Exactly as `pause` does; the
// accumulator is discarded as on any frame that leaves `playing`", with
// `menuIndex` `0`. `specs/ui.md`, "What advances on each screen": "The delta
// time left unconsumed is discarded on any frame or pose that leaves
// `playing`".
//
// THE POSE. An isolated run with entities and timers mid-count and a
// remainder posed by one 25 ms frame (a tick and 0.00833 s waiting), then the
// pose: `paused`, `menuIndex` 0, the whole `run` as before, accumulator 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  placeEnemy,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";

const PARTIAL_FRAME_MS = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pauses with the run untouched and the accumulator discarded", async () => {
  isolate(h);
  const slot = holdWeapon(h, "ember", 3);
  h.debug.setWeaponCooldown(slot, 0.4);
  h.debug.setSpawnTimer(0.7);
  const moth = placeEnemy(h, "moth", 300, 0);
  h.debug.setEnemyContactCooldown(moth, 0.3);
  placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  placePuddle(h, "oil-splash", 50, 50);
  const before = await h.frameOf(PARTIAL_FRAME_MS);
  assertGreaterThan(before.accumulator, 0, "accumulator before the pose");

  h.debug.setScreen("paused");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "paused");

  assertEqual(after.screen, "paused", "screen after setScreen('paused')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('paused')");
  assertDeepEqual(
    after.run,
    before.run,
    "run after pausing, against the run before",
  );
  assertEqual(after.accumulator, 0, "accumulator after setScreen('paused')");
});
