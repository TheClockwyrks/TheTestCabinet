// Wick — shard/rehit-interval: a shard re-hits every `SHARD_REHIT`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "its re-hit
// interval is `SHARD_REHIT` (`0.5`) per shard per enemy"; ("Persistent
// effects"): "A touching effect (each Lantern lantern, each Shard, and each
// Sconce) damages an enemy on any tick the two overlap, at most once per
// re-hit interval per effect per enemy"; ("Projectiles and pierce"): "A
// projectile with infinite pierce hits a given enemy at most once per its
// weapon's re-hit interval, timed per projectile and per enemy from the tick
// of the previous hit." `specs/world.md` ("Timers") makes an interval of `0.5`
// seconds `round(0.5 × 60)` = `30` ticks, and phase 6 counts every re-hit
// entry down before the hits. Row 1 of `SHARD_LEVELS` carries damage `8`, and
// a hound has `120` hp (`specs/enemies.md`). So a shard on a hound hits on
// tick 1, leaving `112`, on tick 31, leaving `104`, and on tick 61, leaving
// `96`, and on no tick between.
//
// THE POSE. One hound and one shard posed on its center with zero velocity and
// infinite pierce, on an isolated night with every faculty held: `effectMotion`
// so the shard stays on the hound, `enemyMotion` so the hound stays under it,
// and the rest so nothing else lands. "`ttl` and every re-hit entry still
// count, and hits still resolve" under the held switches
// (`specs/instrumentation.md`), which is exactly the schedule read here. Every
// tick's hp is read, so a build that re-hits early or late fails on the tick
// it does.
//
// TOLERANCE. `FLOAT_TOL` on the hound's hp on every tick: every figure is a
// whole number and the alternatives are `8` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  SHARD_REHIT,
  dueTicks,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";
import { SHARD, placeShard } from "./stage";

/** Where the hound stands, clear of the lamplighter. */
const HOUND = { x: 200, y: 0 };

/** A shard's level-1 damage, `8`: the row a shard posed with Shard unheld reads. */
const SHARD_DAMAGE = weaponRow(SHARD, 1).damage;

/** Ticks from one hit to the next: `round(0.5 × 60)` = `30`. */
const REHIT_TICKS = dueTicks(SHARD_REHIT);

/** The ticks stepped: the first hit and two re-hits, `61`. */
const TICKS = 2 * REHIT_TICKS + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets a shard on a hound hit on tick 1 and again on ticks 31 and 61, every 30 ticks", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", HOUND.x, HOUND.y);
  await placeShard(h, HOUND, { x: 0, y: 0 });

  const ticks = await captureReplay(h, "rehit", () => h.stepWatching(TICKS));
  assertEqual(ticks.length, TICKS, "ticks stepped");

  for (const [index, snapshot] of ticks.entries()) {
    const tick = index + 1;
    const hits = 1 + Math.floor((tick - 1) / REHIT_TICKS);
    assertNear(
      mustEnemy(snapshot, hound.id).hp,
      ENEMIES.hound.hp - hits * SHARD_DAMAGE,
      FLOAT_TOL,
      `the hound's hp on tick ${tick}, after ${hits} hit(s)`,
    );
  }
});
