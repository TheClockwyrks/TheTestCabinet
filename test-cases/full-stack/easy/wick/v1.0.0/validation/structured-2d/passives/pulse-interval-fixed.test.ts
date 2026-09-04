// Wick — passives/pulse-interval-fixed: a puddle's pulse interval is the named
// constant at every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "The
// intervals a weapon fixes by a named constant are used as written:
// `OIL_PULSE`, `BLAZE_PULSE`, `LANTERN_REHIT`, `SHARD_REHIT`, and
// `SCONCE_REHIT`", and ("What passives leave as written") "every re-hit
// interval, every pulse interval, and every enemy figure are likewise fixed".
// `specs/weapons.md` gives `OIL_PULSE` (`0.3`), and `specs/world.md`
// ("Timers") converts it: "An interval of `s` seconds anywhere in this
// specification is likewise `round(s x TICK_HZ)` ticks", so a puddle pulses
// every `18` ticks whatever Oil is held. A posed shape "first hits and first
// pulses on the next tick" (`specs/instrumentation.md`). A re-hit interval is
// `passives/rehit-interval-fixed`'.
//
// THE POSE. An isolated night with Oil 5 held through `setPassive`, the largest
// `cooldownMul` the specification allows, and one hound under a posed Oil
// Splash puddle. `spawnPuddle` gives the shape "the figures its weapon would
// give" one created now, so it carries the interval its weapon fixes.
// `effectMotion` stays off so the shape does not move; "`ttl` and every re-hit
// entry still count, and hits still resolve" whatever that switch holds. A
// hound's `hp` is `120`, which the puddle's `4` does not take to `0` over the
// drive, and no weapon is held at all.
//
// TOLERANCE. None: the ticks the enemy's `hp` fell on are exact. A build
// scaling the interval by `cooldownMul` (`0.6`) hits on ticks `11` and `19`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  ENEMIES,
  OIL_PULSE,
  OIL_SPLASH_LEVELS,
  REAL_EPS,
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
  placePuddle,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The Oil level held: `cooldownMul` `0.6`, which touches the interval not at all. */
const OIL = 5;

/** Ticks between a puddle's pulses: `round(0.3 x 60)` = `18`. */
const PULSE = ticksOf(OIL_PULSE);

/** The damage the posed puddle carries with no Wick held. */
const PULSE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** Where the hound stands. */
const PUDDLE_AT = { x: 300, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pulses a puddle every 18 ticks under Oil 5", async () => {
  isolate(h);
  holdPassive(h, "oil", OIL);
  const pulsed = placeEnemy(h, "hound", PUDDLE_AT.x, PUDDLE_AT.y);
  placePuddle(h, "oil-splash", PUDDLE_AT.x, PUDDLE_AT.y);

  const hp = (s: WickSnapshot): number => enemyById(s, pulsed)?.hp ?? NaN;
  const full = ENEMIES.hound.hp;

  await captureReplay(h, "interval", async () => {
    const first = await advanceTicks(h, 1);
    assertNear(
      hp(first),
      full - PULSE_DAMAGE,
      REAL_EPS,
      "the hound's hp after the puddle's first pulse (specs/instrumentation.md, spawnPuddle)",
    );

    const before = await advanceTicks(h, PULSE - 1);
    assertNear(
      hp(before),
      full - PULSE_DAMAGE,
      REAL_EPS,
      `the hound's hp on tick ${PULSE}, before the second pulse is due (specs/passives.md, Cooldown)`,
    );

    const second = await advanceTicks(h, 1);
    assertNear(
      hp(second),
      full - 2 * PULSE_DAMAGE,
      REAL_EPS,
      `the hound's hp on tick ${PULSE + 1}, the puddle's second pulse (specs/passives.md, Cooldown)`,
    );
  });
});
