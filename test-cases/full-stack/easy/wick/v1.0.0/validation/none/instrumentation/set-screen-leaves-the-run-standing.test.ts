// Wick — instrumentation/set-screen-leaves-the-run-standing: a `setScreen` off
// `playing` and back leaves the whole run exactly as it stood.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Nothing else changes: the run, the loadout, `offers`, `nextOffers`,
// `chestResult`, `pendingLevelUps`, every posed outcome, `simTime`, and the driver
// switches all stand exactly as they were", and "The pose sets the screen and
// nothing else, so a run is never begun, discarded, ended, or grown by it."
// The comparison is exact equality of the documented run across each call.
//
// WHY THE WORLD IS POSED AS IT IS. `title` is the screen play itself discards a
// run on — specs/ui.md has `TITLE` and `MAIN MENU` leave "the idle run" — so a
// build that wrote this pose as the played transition loses the run there and
// nowhere else. The run holds one entity of every kind, a clock, a spawn timer,
// a hurt lamplighter, a weapon with a timer counting, a level, experience,
// kills, and a queued level-up, so a discard, a restart, or a rebuild is caught
// on some field whichever one it touched. The night is isolated, so no tick
// runs between the readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  holdPassive,
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

/** Figures the posed run carries, none of them an idle run's. */
const POSED = {
  tick: 123,
  spawnTimer: 0.4,
  hp: 55,
  level: 7,
  xp: 12,
  kills: 250,
  pending: 2,
  cooldown: 0.7,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the run across a pose to title and back to playing", async () => {
  await isolate(h);
  await h.debug.setTick(POSED.tick);
  await h.debug.setSpawnTimer(POSED.spawnTimer);
  await h.debug.setHp(POSED.hp);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setPendingLevelUps(POSED.pending);
  const slot = await holdWeapon(h, "ember", 2);
  await h.debug.setWeaponCooldown(slot, POSED.cooldown);
  await holdPassive(h, "brass", 1);
  await placeEnemy(h, "moth", 200, 0);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placePuddle(h, "oil-splash", 50, 50);
  await placeGem(h, "medium", -200, 0);
  await placePickup(h, "bread", 0, -200);
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the first call is made on");

  const title = await poseScreen(h, "title");
  assertEqual(title.screen, "title", "the screen after setScreen('title')");
  assertDeepEqual(
    documentedRun(title.run),
    documentedRun(before.run),
    "the run across the pose to title",
  );

  const back = await poseScreen(h, "playing");
  await captureStill(h, "standing");

  assertEqual(back.screen, "playing", "the screen after setScreen('playing')");
  assertDeepEqual(
    documentedRun(back.run),
    documentedRun(before.run),
    "the run across the pose back to playing",
  );
});
