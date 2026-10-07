// Wick — instrumentation/set-screen-leaves-the-run-standing: a `setScreen` off
// `playing` and back leaves the whole run exactly as it stood.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Nothing else changes: the run, the loadout, `offers`,
// `nextOffers`, `chestResult`, `pendingLevelUps`, every posed outcome, `simTime`, and
// the driver switches all stand exactly as they were", and "The pose sets the
// screen and nothing else, so a run is never begun, discarded, ended, or grown
// by it." The comparison is exact equality of the run's stored fields across
// each call.
//
// WHY THE WORLD IS POSED AS IT IS. `title` is the screen play itself discards a
// run on — `specs/ui.md` has `TITLE` and `MAIN MENU` leave "the idle run" — so
// a build that wrote this pose as the played transition loses the run there and
// nowhere else. The run holds one entity of every kind, a clock, a spawn timer,
// a hurt lamplighter, a weapon with a timer counting, a level, experience,
// kills, and a queued level-up, so a discard, a restart, or a rebuild is caught
// on some field whichever one it touched. The night is isolated, so no tick
// runs between the readings.
//
// WHAT IS SET ASIDE. `pool` alone, because it is derived from the screen rather
// than stored: `specs/instrumentation.md` (Snapshot shape) has it the candidate
// pool on `levelup` and an empty list on every other screen.
//
// THE TOLERANCE. None: the run's stored fields are compared field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  type Harness,
  type SnapshotRun,
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

/** A run with `pool` set aside: it is derived from the screen, not stored. */
function stored(run: SnapshotRun): SnapshotRun {
  return { ...run, pool: [] };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the run across a pose to title and back to playing", async () => {
  isolate(h);
  h.debug.setTick(POSED.tick);
  h.debug.setSpawnTimer(POSED.spawnTimer);
  h.debug.setHp(POSED.hp);
  h.debug.setLevel(POSED.level);
  h.debug.setXp(POSED.xp);
  h.debug.setKills(POSED.kills);
  h.debug.setPendingLevelUps(POSED.pending);
  const slot = holdWeapon(h, "ember", 2);
  h.debug.setWeaponCooldown(slot, POSED.cooldown);
  holdPassive(h, "brass", 1);
  placeEnemy(h, "moth", 200, 0);
  placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  placePuddle(h, "oil-splash", 50, 50);
  placeGem(h, "medium", -200, 0);
  placePickup(h, "bread", 0, -200);
  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the first call is made on");

  h.debug.setScreen("title");
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen after setScreen('title')");
  assertDeepEqual(
    stored(title.run),
    stored(before.run),
    "the run across the pose to title",
  );

  h.debug.setScreen("playing");
  const back = h.snapshot();
  await h.frameDraw();
  captureStill(h, "standing");

  assertEqual(back.screen, "playing", "the screen after setScreen('playing')");
  assertDeepEqual(
    stored(back.run),
    stored(before.run),
    "the run across the pose back to playing",
  );
});
