// Wick — screens/fresh-run-state: the run `LIGHT THE LAMP` begins holds
// exactly what the specification says a fresh run holds.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "A fresh run":
// "`LIGHT THE LAMP` and `TRY AGAIN` each begin a fresh run, and whatever the
// previous run held is discarded. A fresh run has the run clock at `0:00`, the
// lamplighter at the world origin `(0, 0)` with `hp = BASE_MAX_HP` (`100`) and
// `facing = "right"`, level `1` with `xp = 0` and `kills = 0`, Taper at level
// `1` alone in the first weapon slot and no passive held, no enemy, projectile,
// zone, gem, or pickup in the world, no level-up queued, and the spawn timer at
// `0`". `specs/state.md`, "The idle run", adds `offers` empty, `chestResult`
// `null`, and `firedEvents` empty, and "A fresh run is the idle run with Taper
// at level `1` and cooldown `0` in the first weapon slot".
//
// WHY THE PRESS RUNS NO TICK. `specs/controls.md`: "a frame whose press enters
// `playing` ... runs that frame's ticks", and a tick of a fresh run fires
// Taper, spawns from the director, and moves the clock off `0`. The state
// this point is about is the one the PRESS left, so the press is delivered on
// a frame of a single millisecond: `specs/instrumentation.md` says "a clock of
// any other length poses a partial frame", and a tick is consumed only while
// the accumulator holds `TICK_DT − TICK_EPSILON`, which a millisecond is far
// short of. The screen therefore reads `playing` with the run at tick `0`.
//
// THE DRIVE. `reset` to the title, whose arrival highlights `LIGHT THE LAMP`,
// and one real `Enter` on a partial frame.
//
// THE TOLERANCE. None: every figure is a whole number, a list length, a
// string, or `null`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  FRESH_WEAPONS,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { tapPartial } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("begins the run the specification describes, before any tick", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the press is made on");
  assertEqual(before.menuIndex, 0, "the highlighted item, LIGHT THE LAMP");

  const fresh = await tapPartial(h, "Enter");
  captureStill(h, "fresh");

  assertEqual(fresh.screen, "playing", "the screen after confirming");
  assertEqual(fresh.run.tick, 0, "the run clock a fresh run starts at");
  assertEqual(fresh.run.level, 1, "the level a fresh run starts at");
  assertEqual(fresh.run.xp, 0, "the experience a fresh run starts with");
  assertEqual(fresh.run.kills, 0, "the kills a fresh run starts with");
  assertEqual(fresh.run.player.x, 0, "the lamplighter's x, the world origin");
  assertEqual(fresh.run.player.y, 0, "the lamplighter's y, the world origin");
  assertEqual(
    fresh.run.player.facing,
    "right",
    "the facing a fresh run starts with",
  );
  assertEqual(fresh.run.player.hp, BASE_MAX_HP, "hp on a fresh run");
  assertDeepEqual(
    fresh.run.weapons,
    FRESH_WEAPONS,
    "the loadout a fresh run starts with (specs/ui.md, A fresh run)",
  );
  assertLength(fresh.run.passives, 0, "the passives a fresh run holds");
  assertLength(fresh.run.enemies, 0, "the enemies in a fresh run's world");
  assertLength(
    fresh.run.projectiles,
    0,
    "the projectiles in a fresh run's world",
  );
  assertLength(fresh.run.zones, 0, "the zones in a fresh run's world");
  assertLength(fresh.run.gems, 0, "the gems in a fresh run's world");
  assertLength(fresh.run.pickups, 0, "the pickups in a fresh run's world");
  assertLength(fresh.run.offers, 0, "the offers a fresh run holds");
  assertEqual(fresh.run.pendingLevelUps, 0, "the level-ups a fresh run queues");
  assertNull(fresh.run.chestResult, "chestResult on a fresh run");
  assertLength(
    fresh.run.firedEvents,
    0,
    "the scripted events a fresh run has fired",
  );
  assertEqual(fresh.run.spawnTimer, 0, "the spawn timer a fresh run starts at");
});
