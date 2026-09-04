// passives/intervals-fixed — a pulse interval and a re-hit interval are what
// their constants give, at every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Cooldown: "The
// intervals a weapon fixes by a named constant are used as written:
// `OIL_PULSE`, `BLAZE_PULSE`, `LANTERN_REHIT`, `SHARD_REHIT`, and
// `SCONCE_REHIT`", and What passives leave as written: "`pierce`, every re-hit
// interval, every pulse interval, and every enemy figure are likewise fixed."
// `OIL_PULSE` is `0.3` and `SHARD_REHIT` is `0.5` (`specs/weapons.md`), and
// `specs/world.md` (Timers) turns each into ticks: "An interval of `s` seconds
// anywhere in this specification is likewise `round(s × TICK_HZ)` ticks", so
// `18` and `30`. Under Oil 5, `cooldownMul` is `0.6`; a build that scaled
// these two would pulse every `11` ticks and re-hit every `18`.
//
// WHEN EACH SHAPE FIRST ACTS. `specs/instrumentation.md`: a posed puddle
// "pulses first on the next tick and every `OIL_PULSE` or `BLAZE_PULSE`
// after", and a posed projectile "first hits ... on the next tick". So the
// puddle pulses on ticks `1` and `19`, and the shard hits on ticks `1` and
// `31`.
//
// WHAT IS READ. Each hound's hp after those ticks and between them. A puddle's
// pulse "deals `damage` to every enemy overlapping it" and a posed puddle's
// damage is "that row's damage times the `damageMul` in force at the call",
// which is `4 × 1` with no Wick held; a shard's is `8 × 1` the same way. A
// hound carries `120` hp (`specs/enemies.md`) and the run clock is `0`, so
// nothing scales it and neither hound dies inside the watch.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Oil 5 and no weapon
// at all, with one hound at `(300, 0)` under a posed Oil Splash puddle and
// another at `(-300, 0)` under a posed shard. The two are six hundred units
// apart, so the puddle's radius of `50` reaches only its own hound and the
// shard's of `8` only its own. `enemyMotion` is off, so both hounds stand
// where they were posed; `effectMotion` is off, so the shard holds its
// position, and "`ttl` and every re-hit entry still count, and hits still
// resolve" (`specs/instrumentation.md`). The puddle's `ttl` of `2.5` seconds
// and the shard's of `3.0` both outlast the thirty-one ticks watched.
//
// THE TOLERANCE. `REAL_EPS` on each hp reading, a whole figure less one or two
// whole damages; the ticks are whole counts, run exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  ENEMIES,
  INFINITE_PIERCE,
  OIL_PULSE,
  OIL_SPLASH_LEVELS,
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
  placePuddle,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The Oil level held: `cooldownMul` `0.6`, which touches neither interval. */
const OIL = 5;

/** Ticks between a puddle's pulses: `round(0.3 × 60)` = `18`. */
const PULSE = ticksOf(OIL_PULSE);

/** Ticks between a shard's hits on one enemy: `round(0.5 × 60)` = `30`. */
const REHIT = ticksOf(SHARD_REHIT);

/** The damage each posed shape carries with no Wick held. */
const PULSE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;
const SHARD_DAMAGE = SHARD_LEVELS[0].damage;

/** Where each hound stands, far enough apart that neither shape reaches both. */
const PUDDLE_AT = { x: 300, y: 0 };
const SHARD_AT = { x: -300, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pulses a puddle every 18 ticks and re-hits with a shard every 30 under Oil 5", async () => {
  isolate(h);
  holdPassive(h, "oil", OIL);
  const pulsed = placeEnemy(h, "hound", PUDDLE_AT.x, PUDDLE_AT.y);
  const struck = placeEnemy(h, "hound", SHARD_AT.x, SHARD_AT.y);
  placePuddle(h, "oil-splash", PUDDLE_AT.x, PUDDLE_AT.y);
  placeProjectile(
    h,
    "shard",
    SHARD_AT.x,
    SHARD_AT.y,
    SHARD_LEVELS[0].speed,
    0,
    INFINITE_PIERCE,
  );

  const hp = (s: WickSnapshot, id: number): number =>
    enemyById(s, id)?.hp ?? NaN;
  const full = ENEMIES.hound.hp;

  await captureReplay(h, "intervals", async () => {
    const first = await advanceTicks(h, 1);
    assertNear(
      hp(first, pulsed),
      full - PULSE_DAMAGE,
      REAL_EPS,
      "the pulsed hound's hp after the puddle's first pulse (specs/instrumentation.md, spawnPuddle)",
    );
    assertNear(
      hp(first, struck),
      full - SHARD_DAMAGE,
      REAL_EPS,
      "the struck hound's hp after the shard's first hit (specs/instrumentation.md, spawnProjectile)",
    );

    const beforePulse = await advanceTicks(h, PULSE - 1);
    assertNear(
      hp(beforePulse, pulsed),
      full - PULSE_DAMAGE,
      REAL_EPS,
      `the pulsed hound's hp on tick ${PULSE}, before the second pulse is due (specs/passives.md, Cooldown)`,
    );

    const secondPulse = await advanceTicks(h, 1);
    assertNear(
      hp(secondPulse, pulsed),
      full - 2 * PULSE_DAMAGE,
      REAL_EPS,
      `the pulsed hound's hp on tick ${PULSE + 1}, the puddle's second pulse (specs/passives.md, Cooldown)`,
    );

    const beforeRehit = await advanceTicks(h, REHIT - PULSE - 1);
    assertNear(
      hp(beforeRehit, struck),
      full - SHARD_DAMAGE,
      REAL_EPS,
      `the struck hound's hp on tick ${REHIT}, before the shard's re-hit is due (specs/passives.md, Cooldown)`,
    );

    const rehit = await advanceTicks(h, 1);
    assertNear(
      hp(rehit, struck),
      full - 2 * SHARD_DAMAGE,
      REAL_EPS,
      `the struck hound's hp on tick ${REHIT + 1}, the shard's second hit (specs/passives.md, Cooldown)`,
    );
  });
});
