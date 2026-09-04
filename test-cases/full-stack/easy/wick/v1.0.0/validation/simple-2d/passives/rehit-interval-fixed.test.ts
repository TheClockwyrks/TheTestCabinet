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
import {
  INFINITE_PIERCE,
  SHARD_REHIT,
  ticksFor,
  type HeldPassives,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { holdPassives } from "./night";

/** The passives held: Oil at level 5, whose cooldownMul is 0.6. */
const HELD: HeldPassives = { oil: 5 };

/** The enemy under the shape: 120 health, radius 18. */
const TARGET = "hound";

/** Where it stands, an offset from the lamplighter's center. */
const OFFSET = { x: 200, y: 0 };

/** round(0.5 x 60) = 30 ticks between a shard's hits on one enemy. */
const INTERVAL = ticksFor(SHARD_REHIT);

/** The ticks a schedule of `interval` lands on within `count` of them. */
function schedule(interval: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => 1 + i * interval);
}

/** The ticks of `trace` on which the hound's health fell, counted from 1. */
function fallTicks(
  trace: readonly WickSnapshot[],
  id: number,
  from: number,
): number[] {
  const ticks: number[] = [];
  let previous = from;
  trace.forEach((snapshot, index) => {
    const hp = present(
      enemyById(snapshot, id),
      `the hound on tick ${index + 1}`,
    ).hp;
    if (hp < previous) ticks.push(index + 1);
    previous = hp;
  });
  return ticks;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-hits with a shard every 30 ticks under Oil 5", async () => {
  isolate(h);
  holdPassives(h, HELD);
  const under = spawnEnemyNear(h, TARGET, OFFSET.x, OFFSET.y);
  const posed = present(
    enemyById(h.snapshot(), under),
    "the hound the shard is laid on",
  );
  spawnProjectileAt(h, "shard", posed.x, posed.y, 500, 0, INFINITE_PIERCE);

  const trace = await captureReplay(h, "interval", () =>
    h.trace(2 * INTERVAL + 1),
  );
  assertDeepEqual(
    fallTicks(trace, under, posed.hp),
    schedule(INTERVAL, 3),
    "the ticks the shard's hits took health on, under Oil 5",
  );
});
