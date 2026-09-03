// passives/intervals-fixed — a pulse interval and a re-hit interval are used as
// written whatever Oil is held.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Cooldown"): "The
// intervals a weapon fixes by a named constant are used as written: OIL_PULSE,
// BLAZE_PULSE, LANTERN_REHIT, SHARD_REHIT, and SCONCE_REHIT", and ("What
// passives leave as written") "`pierce`, every re-hit interval, every pulse
// interval, and every enemy figure are likewise fixed". OIL_PULSE is 0.3 and
// SHARD_REHIT is 0.5 (specs/weapons.md), and specs/world.md ("Timers") makes an
// interval of s seconds "round(s × TICK_HZ) ticks", so a puddle pulses every 18
// ticks and a shard re-hits every 30, rather than the 11 and 18 that Oil 5's
// cooldownMul of 1 − 0.08 × 5 = 0.6 would give. specs/weapons.md ("Oil
// Splash"): a puddle "pulses on the tick it appears and on every OIL_PULSE
// interval of ticks after"; ("Persistent effects") a shard "damages an enemy on
// any tick the two overlap, at most once per re-hit interval per effect per
// enemy"; and specs/instrumentation.md has a posed puddle pulse "first on the
// next tick" and a posed projectile "first hit on the next tick", so both
// schedules start one tick after the pose.
//
// THE WORLD. Two isolated playing runs, one for each interval, each holding Oil
// at level 5 and nothing else, with every driver switch off. Each stands one
// hound at the origin's side and lays exactly one shape over it: a puddle
// centred on the hound in the first run, and a shard of infinite pierce at the
// hound's center in the second. No weapon is held, so nothing fires and the
// only damage the hound can take is the one shape's; enemyMotion off holds the
// hound under the shape and effectMotion off holds the shard on it, which
// leaves the schedule the only thing that decides when health falls. A hound
// carries 120 health and the level-1 rows deal 4 and 8, so it survives every
// hit of the sweep and each hit is visible as a fall.
//
// WHAT IS READ. The ticks of each sweep on which the hound's health fell:
// [1, 19, 37] under the puddle and [1, 31, 61] under the shard. The whole list
// is read rather than one interval, because a build that pulses on a shortened
// schedule and one that pulses once are told apart only by where the falls
// land.
//
// TOLERANCE. None: a tick is a whole count, and a fall in health is read as a
// change rather than against a figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  INFINITE_PIERCE,
  OIL_PULSE,
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
  spawnPuddleAt,
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

/** round(0.3 × 60) = 18 ticks between pulses. */
const PULSE_TICKS = ticksFor(OIL_PULSE);

/** round(0.5 × 60) = 30 ticks between a shard's hits on one enemy. */
const REHIT_TICKS = ticksFor(SHARD_REHIT);

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

it("pulses a puddle every 18 ticks and re-hits with a shard every 30 under Oil 5", async () => {
  isolate(h);
  holdPassives(h, HELD);
  const underPuddle = spawnEnemyNear(h, TARGET, OFFSET.x, OFFSET.y);
  const puddled = present(
    enemyById(h.snapshot(), underPuddle),
    "the hound the puddle is laid over",
  );
  spawnPuddleAt(h, "oil-splash", puddled.x, puddled.y);

  const pulses = await captureReplay(h, "intervals", () =>
    h.trace(2 * PULSE_TICKS + 1),
  );
  assertDeepEqual(
    fallTicks(pulses, underPuddle, puddled.hp),
    schedule(PULSE_TICKS, 3),
    "the ticks the puddle's pulses took health on, under Oil 5",
  );

  isolate(h);
  holdPassives(h, HELD);
  const underShard = spawnEnemyNear(h, TARGET, OFFSET.x, OFFSET.y);
  const shot = present(
    enemyById(h.snapshot(), underShard),
    "the hound the shard is laid on",
  );
  spawnProjectileAt(h, "shard", shot.x, shot.y, 500, 0, INFINITE_PIERCE);

  const rehits = await h.trace(2 * REHIT_TICKS + 1);
  assertDeepEqual(
    fallTicks(rehits, underShard, shot.hp),
    schedule(REHIT_TICKS, 3),
    "the ticks the shard's hits took health on, under Oil 5",
  );
});
