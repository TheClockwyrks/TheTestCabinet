// pickups/sample — the one seeded sample of common kills the four drop-roll
// points read. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide keeps beside the
// checks rather than inside any one of them; each point asserts its own
// reading of what the sample left.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/world.md ("The drop roll"): "Each common enemy killed by a weapon
//     draws from the game's seeded random generator on the tick it dies. A
//     first draw, uniform on `[0, 1)`, drops bread when it is below
//     `BREAD_CHANCE` (`0.02`). Only when it did not, a second draw drops a
//     draft when it is below `DRAFT_CHANCE` (`0.005`). A kill therefore drops
//     at most one of the two, and the pickup lands at the enemy's position
//     beside its gem."
//   - specs/overview.md, through specs/instrumentation.md: the game holds one
//     generator "seeded by `reset`", and "Given the same seed, the same
//     sequence of operations, and the same number of ticks, the game reaches
//     the same `run` and `rngState` every time", so this sample is one fixed
//     experiment rather than a fresh one on every run.
//   - specs/world.md ("One tick", phase 6): "an enemy whose `hp` is at or
//     below `0` dies: its drop and its bread or draft land at its center", so
//     what a kill drew is read off the field at the point that kill happened.
//
// WHY THE NIGHT IS POSED AS IT IS. `DROP_SAMPLE` (4000) moths are killed by
// posed Ember bolts, `BATCH` (100) to a tick, each on its own point of a grid
// `SPACING` (100) units apart, and each batch's grid shifted a further
// `BATCH_SPAN` (2000) units along `+x`, so every one of the four thousand
// kills happens at a point no other kill happens at and a pickup's center
// names the kill that dropped it. The grid starts `FIELD_DX` (4000) units from
// the lamplighter and only moves away, so no gem is ever attracted, no pickup
// is ever collected, and everything a kill leaves stays where it fell. Every
// driver switch is off and no weapon is held, so nothing spawns, nothing
// moves, nothing else fires, and the only draws the generator can be asked for
// across the whole sample are the drop roll's. 100 units between points is more
// than five times the 18 that an Ember bolt's radius (8) and a moth's (10) add
// up to, so each bolt kills its own moth and no other.
//
// WHAT THE GENERATOR IS READ FOR. The sample reports `rngState` as the night
// stood before its first kill and as it stood after its last. specs/
// instrumentation.md ("A deterministic core"): the game "holds one
// pseudo-random generator, seeded by `reset` and keeping its whole state in
// `rngState`, and every random draw comes from it". Nothing else here draws, so
// the distance between the two readings is exactly the draws the sample's kills
// made, and `drop-at-most-one` measures it against `advanceRng`.
//
// The gems and pickups a batch left are cleared at the start of the next one,
// which "Removes every gem; no experience is gained" and "Removes every pickup;
// nothing is collected" (specs/instrumentation.md), neither of which draws
// anything; each batch's pickups are read off the field before that. Nothing is
// reset between batches, so the four thousand draws are one unbroken run of the
// generator.

import { assertEqual, assertLength } from "../assert";
import { DROP_SAMPLE, PICKUP_KINDS, type PickupKind } from "../constants";
import {
  captureStill,
  enable,
  isolate,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { armKill } from "./night";

/** Kills made on one tick. */
const BATCH = 100;

/** Kill points across one row of a batch's grid. */
const COLUMNS = 10;

/** Units between neighbouring kill points, well past the bolt's reach. */
const SPACING = 100;

/** Where the first batch's grid begins, far from the lamplighter. */
const FIELD_DX = 4000;

/** How far each batch's grid is shifted from the one before it. */
const BATCH_SPAN = 2000;

/** The common killed: specs/enemies.md ranks the moth `common`. */
const TYPE = "moth";

/** One pickup the sample left, and where it fell. */
export interface SampledPickup {
  kind: PickupKind;
  x: number;
  y: number;
}

/** What the sample of {@link DROP_SAMPLE} kills left on the field. */
export interface DropSample {
  /** Kills made, `DROP_SAMPLE`. */
  kills: number;
  /** Every pickup left, in the order the field reports them. */
  pickups: readonly SampledPickup[];
  /** How many of each kind fell. */
  counts: Readonly<Record<PickupKind, number>>;
  /** The most pickups any single kill point carries. */
  mostPerPoint: number;
  /** Pickups that fell on no kill point. */
  strays: number;
  /** The night after the last batch's tick. */
  after: WickSnapshot;
  /**
   * `rngState` as the isolated night stood before the first kill, which is
   * where a replay of the sample's draws begins.
   */
  startRng: number;
  /** `rngState` after the last batch's tick, the sample's draws behind it. */
  endRng: number;
}

/** A kill point's key, to the unit; points are 100 units apart. */
function keyOf(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

/**
 * Kill `DROP_SAMPLE` common enemies from one seed, each on its own point, and
 * hand back what their drop rolls left, keeping the final frame as the point's
 * `outputId` output.
 */
export async function drawDrops(
  h: Harness,
  outputId: string,
): Promise<DropSample> {
  const opened = isolate(h);
  // The drop roll is the requirement this sample decides, so `drops` is the
  // one faculty turned back on.
  enable(h, "drops");
  const startRng = opened.rngState;
  const points = new Set<string>();
  const pickups: SampledPickup[] = [];
  const perPoint = new Map<string, number>();

  let after = h.snapshot();
  for (let killed = 0; killed < DROP_SAMPLE; killed += BATCH) {
    if (killed > 0) {
      h.debug.clearGems();
      h.debug.clearPickups();
    }
    const shift = FIELD_DX + (killed / BATCH) * BATCH_SPAN;
    for (let i = 0; i < BATCH; i += 1) {
      const at = armKill(
        h,
        TYPE,
        shift + (i % COLUMNS) * SPACING,
        Math.floor(i / COLUMNS) * SPACING,
      );
      points.add(keyOf(at.x, at.y));
    }
    after = await h.tick(1);
    assertLength(after.run.enemies, 0, "enemies left after a batch's kills");
    for (const pickup of after.run.pickups) {
      const key = keyOf(pickup.x, pickup.y);
      perPoint.set(key, (perPoint.get(key) ?? 0) + 1);
      pickups.push({ kind: pickup.kind, x: pickup.x, y: pickup.y });
    }
  }

  captureStill(h, outputId);
  assertEqual(points.size, DROP_SAMPLE, "distinct kill points in the sample");

  const counts: Record<PickupKind, number> = { chest: 0, bread: 0, draft: 0 };
  for (const kind of PICKUP_KINDS) {
    counts[kind] = pickups.filter((pickup) => pickup.kind === kind).length;
  }
  let mostPerPoint = 0;
  for (const count of perPoint.values()) {
    mostPerPoint = Math.max(mostPerPoint, count);
  }
  const strays = [...perPoint.keys()].filter((key) => !points.has(key)).length;

  return {
    kills: DROP_SAMPLE,
    pickups,
    counts,
    mostPerPoint,
    strays,
    after,
    startRng,
    endRng: after.rngState,
  };
}
