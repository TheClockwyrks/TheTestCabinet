// screens/fresh-run-discards-previous — a fresh run keeps nothing of the run
// before it.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("A fresh run"): "`LIGHT THE
// LAMP`, `TRY AGAIN`, and the debug surface's `setScreen("playing")` each begin
// a fresh run, and whatever the previous run held is discarded", and the fresh
// run's own figures follow: the clock at `0:00`, the lamplighter at the origin
// at `BASE_MAX_HP` (`100`), level `1` with `xp = 0` and `kills = 0`, "Taper at
// level `1` alone in the first weapon slot and no passive held, no enemy,
// projectile, zone, gem, or pickup in the world, no level-up queued, and the
// spawn timer at `0`". specs/ui.md ("`fallen` and `dawn`"): "`TRY AGAIN` starts
// a fresh run and sets `screen = playing`".
//
// WHY THE WORLD IS POSED AS IT IS. The previous run is made to hold, at the
// moment it ends, one of everything a fresh run must not inherit: two enemies,
// a gem, a pickup, a projectile, a puddle, a loadout of Taper and Brass, a
// clock, a level, experience, kills, two level-ups queued, and a chest result.
// The chest result is on the field because specs/world.md ("Fallen and dawn")
// keeps one there: "a chest it collected has its result applied and no overlay
// shown, with `chestResult` left set so the end screen's run reports it". The
// chest is opened on the ending tick with Taper at level `3` and Brass at level
// `1` held, so its result is the LEVEL rule of specs/evolutions.md rather than
// the heal, which would have lifted `hp` off `0` and left the run running.
// Every driver switch is held off, so nothing the fresh run's first frame does
// can put an entity back and pass this by accident.
//
// THE TOLERANCE. None: the comparison is the whole documented run against the
// fresh run specs/ui.md fixes, less the clock, which the frame that confirms
// also ticks once (specs/controls.md); the run's own first tick is
// `fresh-run-state`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  FRESH_TAPER,
  holdPassive,
  holdWeapon,
  idleRun,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  pressConfirm,
  type Harness,
} from "../harness";
import { endFallen, night } from "./stage";

/** Taper's level: below `MAX_WEAPON_LEVEL`, so the chest levels rather than evolves. */
const TAPER_LEVEL = 3;

/** Brass's level: below its own max of 3, so the level rule has an item to raise. */
const BRASS_LEVEL = 1;

/** The clock the previous run ends at, and figures no fresh run carries. */
const POSED = { tick: 4500, level: 7, xp: 12, kills: 250, pending: 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a run holding none of what the previous run ended with", async () => {
  await night(h);
  await holdWeapon(h, "taper", TAPER_LEVEL, 0);
  await holdPassive(h, "brass", BRASS_LEVEL, 0);
  await h.debug.setTick(POSED.tick);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setPendingLevelUps(POSED.pending);
  await placeEnemy(h, "moth", 200, 0);
  await placeEnemy(h, "bat", -200, 0);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placePuddle(h, "oil-splash", 50, 50);
  await placeGem(h, "medium", -100, 0);
  await placePickup(h, "bread", 0, -100);
  const at = (await h.snapshot()).run.player;
  await placePickup(h, "chest", at.x, at.y);

  const ended = await endFallen(h);
  assertNotNull(
    ended.run.chestResult,
    "the chest result the ended run reports",
  );
  assertEqual(
    ended.run.pendingLevelUps,
    POSED.pending,
    "the level-ups the ended run queued",
  );
  assertEqual(
    (ended.run.enemies ?? []).length,
    2,
    "the enemies the ended run held",
  );
  assertEqual((ended.run.gems ?? []).length, 1, "the gems the ended run held");
  assertEqual(ended.menuIndex, 0, "the highlighted item, TRY AGAIN");

  const fresh = await pressConfirm(h);
  await captureStill(h, "discarded");

  assertEqual(fresh.screen, "playing", "the screen TRY AGAIN left");
  assertDeepEqual(
    { ...documentedRun(fresh.run), tick: 0, time: 0 },
    idleRun([FRESH_TAPER]),
    "the run TRY AGAIN begins, less the clock the confirming frame ticked",
  );
  assertEqual(
    fresh.run.tick,
    1,
    "the run clock after the frame that restarted",
  );
});
