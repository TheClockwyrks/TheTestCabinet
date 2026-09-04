// Wick — passives/intervals-fixed: a pulse interval and a re-hit interval are
// the named constants at every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Cooldown"): "The
// intervals a weapon fixes by a named constant are used as written:
// `OIL_PULSE`, `BLAZE_PULSE`, `LANTERN_REHIT`, `SHARD_REHIT`, and
// `SCONCE_REHIT`", and ("What passives leave as written") "every re-hit
// interval, every pulse interval, and every enemy figure are likewise fixed".
// `specs/weapons.md` gives `OIL_PULSE` (`0.3`) and `SHARD_REHIT` (`0.5`), and
// `specs/world.md` ("Timers") converts each: "An interval of `s` seconds
// anywhere in this specification is likewise `round(s × TICK_HZ)` ticks", so a
// puddle pulses every `18` ticks and a shard re-hits every `30`, whatever Oil
// is held. A posed shape "first hits and first pulses on the next tick"
// (`specs/instrumentation.md`), so over `DRIVE` (`40`) ticks the puddle hits on
// ticks `1`, `19`, and `37` and the shard on `1` and `31`.
//
// THE POSE. An isolated night with Oil 5 held through `setPassive`, the largest
// `cooldownMul` the specification allows. Two hounds stand `SEPARATION` (`200`)
// units either side of the lamplighter, one under a posed Oil Splash puddle and
// one under a posed shard, each far enough from the other that neither shape
// reaches both: a hound is a circle of radius `18` and the shapes are `50` and
// `8` (`specs/enemies.md`, `specs/weapons.md`). `spawnPuddle` and
// `spawnProjectile` give each shape "the figures its weapon would give" one
// created now, so both carry the intervals their weapon fixes. The shard is
// posed with a zero velocity, which `spawnProjectile` allows for every weapon
// but Sconce, and `effectMotion` stays off so neither shape moves; "`ttl` and
// every re-hit entry still count, and hits still resolve" whatever that switch
// holds. A hound's `hp` is `120`, which neither the puddle's `4` nor the
// shard's `8` takes to `0` over the drive, and no weapon is held at all.
//
// TOLERANCE. None: the ticks an enemy's `hp` fell on are exact. A build scaling
// either interval by `cooldownMul` (`0.6`) hits on ticks `11` and `19` for the
// puddle and `19` for the shard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  INFINITE_PIERCE,
  OIL_PULSE,
  SHARD_REHIT,
  dueTicks,
} from "../constants";
import {
  captureReplay,
  createHarness,
  holdPassive,
  isolate,
  placeEnemyNear,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";
import { ticksEnemyHpFell } from "./stage";

/** The Oil level held: `cooldownMul` `0.6`, the largest the passive allows. */
const OIL_LEVEL = 5;

/** How far either side of the lamplighter each target stands. */
const SEPARATION = 200;

/** The ticks the cadences are read over. */
const DRIVE = 40;

/** `round(0.3 × 60)`. */
const PULSE = dueTicks(OIL_PULSE);

/** `round(0.5 × 60)`. */
const REHIT = dueTicks(SHARD_REHIT);

/** The ticks a puddle posed now pulses on: the next, and every interval after. */
const PULSES = [1, 1 + PULSE, 1 + PULSE * 2];

/** The ticks a shard posed now hits on: the next, and every interval after. */
const HITS = [1, 1 + REHIT];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pulses a puddle every 18 ticks and re-hits with a shard every 30 with Oil 5 held", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);
  const at = opened.run.player;

  const pulsed = await placeEnemyNear(h, "hound", SEPARATION, 0);
  await placePuddle(h, "oil-splash", at.x + SEPARATION, at.y);
  const struck = await placeEnemyNear(h, "hound", -SEPARATION, 0);
  await placeProjectile(
    h,
    "shard",
    at.x - SEPARATION,
    at.y,
    0,
    0,
    INFINITE_PIERCE,
  );

  const posed = await h.snapshot();
  const ticks = await captureReplay(h, "intervals", () =>
    h.stepWatching(DRIVE),
  );

  assertDeepEqual(
    ticksEnemyHpFell(posed, ticks, pulsed.id),
    PULSES,
    "the ticks the puddle's pulses landed on with Oil 5 held",
  );
  assertDeepEqual(
    ticksEnemyHpFell(posed, ticks, struck.id),
    HITS,
    "the ticks the shard's hits landed on with Oil 5 held",
  );
});
