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
import { assertDeepEqual } from "../assert";
import { INFINITE_PIERCE, SHARD_REHIT, dueTicks } from "../constants";
import {
  captureReplay,
  createHarness,
  holdPassive,
  isolate,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";
import { ticksEnemyHpFell } from "./stage";

/** The Oil level held: `cooldownMul` `0.6`, the largest the passive allows. */
const OIL_LEVEL = 5;

/** How far from the lamplighter the target stands. */
const SEPARATION = 200;

/** The ticks the cadence is read over. */
const DRIVE = 40;

/** `round(0.5 x 60)`. */
const REHIT = dueTicks(SHARD_REHIT);

/** The ticks a shard posed now hits on: the next, and every interval after. */
const HITS = [1, 1 + REHIT];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-hits with a shard every 30 ticks with Oil 5 held", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "oil", OIL_LEVEL);
  const at = opened.run.player;

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
  const ticks = await captureReplay(h, "interval", () => h.stepWatching(DRIVE));

  assertDeepEqual(
    ticksEnemyHpFell(posed, ticks, struck.id),
    HITS,
    "the ticks the shard's hits landed on with Oil 5 held",
  );
});
