// Wick — passives/rehit-interval-fixed: a shard's re-hit interval is the named
// constant at every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "The
// intervals a weapon fixes by a named constant are used as written:
// `OIL_PULSE`, `BLAZE_PULSE`, `LANTERN_REHIT`, `SHARD_REHIT`, and
// `SCONCE_REHIT`", and ("What passives leave as written") "every re-hit
// interval, every pulse interval, and every enemy figure are likewise fixed".
// `specs/weapons.md` gives `SHARD_REHIT` (`0.5`), and `specs/world.md`
// ("Timers") converts it: "An interval of `s` seconds anywhere in this
// specification is likewise `round(s x TICK_HZ)` ticks", so a shard re-hits
// every `30` ticks whatever Oil is held. A posed shape "first hits and first
// pulses on the next tick" (`specs/instrumentation.md`). A pulse interval is
// `passives/pulse-interval-fixed`'.
//
// THE POSE. An isolated night with Oil 5 held through `setPassive`, the largest
// `cooldownMul` the specification allows, and one hound under a posed shard.
// `spawnProjectile` gives the shape "the figures its weapon would give" one
// created now, so it carries the interval its weapon fixes. The shard is posed
// with a zero velocity, which `spawnProjectile` allows for every weapon but
// Sconce, and `effectMotion` stays off so it does not move; "`ttl` and every
// re-hit entry still count, and hits still resolve" whatever that switch holds.
// A hound's `hp` is `120`, which the shard's `8` does not take to `0` over the
// drive, and no weapon is held at all.
//
// TOLERANCE. None: the ticks the enemy's `hp` fell on are exact. A build
// scaling the interval by `cooldownMul` (`0.6`) hits on tick `19`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  ENEMIES,
  INFINITE_PIERCE,
  REAL_EPS,
  SHARD_LEVELS,
  SHARD_REHIT,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enemyById,
  holdPassive,
  isolate,
  placeEnemy,
  placeProjectile,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The Oil level held: `cooldownMul` `0.6`, which touches the interval not at all. */
const OIL = 5;

/** Ticks between a shard's hits on one enemy: `round(0.5 x 60)` = `30`. */
const REHIT = ticksOf(SHARD_REHIT);

/** The damage the posed shard carries with no Wick held. */
const SHARD_DAMAGE = SHARD_LEVELS[0].damage;

/** Where the hound stands. */
const SHARD_AT = { x: -300, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("re-hits with a shard every 30 ticks under Oil 5", async () => {
  isolate(h);
  holdPassive(h, "oil", OIL);
  const struck = placeEnemy(h, "hound", SHARD_AT.x, SHARD_AT.y);
  placeProjectile(
    h,
    "shard",
    SHARD_AT.x,
    SHARD_AT.y,
    SHARD_LEVELS[0].speed,
    0,
    INFINITE_PIERCE,
  );

  const hp = (s: WickSnapshot): number => enemyById(s, struck)?.hp ?? NaN;
  const full = ENEMIES.hound.hp;

  await captureReplay(h, "interval", async () => {
    const first = await advanceTicks(h, 1);
    assertNear(
      hp(first),
      full - SHARD_DAMAGE,
      REAL_EPS,
      "the hound's hp after the shard's first hit (specs/instrumentation.md, spawnProjectile)",
    );

    const before = await advanceTicks(h, REHIT - 1);
    assertNear(
      hp(before),
      full - SHARD_DAMAGE,
      REAL_EPS,
      `the hound's hp on tick ${REHIT}, before the re-hit is due (specs/passives.md, Cooldown)`,
    );

    const second = await advanceTicks(h, 1);
    assertNear(
      hp(second),
      full - 2 * SHARD_DAMAGE,
      REAL_EPS,
      `the hound's hp on tick ${REHIT + 1}, the shard's second hit (specs/passives.md, Cooldown)`,
    );
  });
});
