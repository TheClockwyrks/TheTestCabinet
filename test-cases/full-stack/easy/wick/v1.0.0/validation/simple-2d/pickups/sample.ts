// pickups/sample — the sample of common kills the two drop-rate points read,
// and the one posed kill the drop points read. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide keeps beside the
// checks rather than inside any one of them; each point asserts its own
// reading of what the sample or the kill left.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/world.md ("The drop roll"): "each common enemy killed by a weapon
//     rolls for a pickup on the tick it dies ... The roll drops bread with
//     probability `BREAD_CHANCE` (`0.02`), and only when it dropped no bread
//     it drops a draft with probability `DRAFT_CHANCE` (`0.005`), so a kill
//     drops one pickup or none. The pickup lands at the enemy's position
//     beside its gem."
//   - specs/instrumentation.md ("Drawn outcomes"), `setNextDrop(kind)`: "The
//     next common enemy killed by a weapon while `drops` is on drops that
//     pickup beside its gem, or nothing for `none`, in place of its roll, and
//     that kill consumes it."
//   - specs/world.md ("One tick", phase 6): "an enemy whose `hp` is at or
//     below `0` dies: its drop and its bread or draft land at its center", so
//     what a kill dropped is read off the field at the point that kill
//     happened.
//
// WHY THE NIGHT IS POSED AS IT IS. `DROP_SAMPLE` (4000) moths are killed by
// posed Ember bolts, `BATCH` (100) to a tick, each on its own point of a grid
// `SPACING` (100) units apart, and each batch's grid shifted a further
// `BATCH_SPAN` (2000) units along `+x`, so every one of the four thousand
// kills happens at a point no other kill happens at and a pickup's center
// names the kill that dropped it. The grid starts `FIELD_DX` (4000) units from
// the lamplighter and only moves away, so no gem is ever attracted, no pickup
// is ever collected, and everything a kill leaves stays where it fell. Every
// driver switch is off but `drops` and no weapon is held, so nothing spawns,
// nothing moves, nothing else fires, and the only rolls the ticks make across
// the whole sample are the kills' own. 100 units between points is more than
// five times the 18 that an Ember bolt's radius (8) and a moth's (10) add up
// to, so each bolt kills its own moth and no other.
//
// The gems and pickups a batch left are cleared at the start of the next one,
// which "Removes every gem; no experience is gained" and "Removes every pickup;
// nothing is collected" (specs/instrumentation.md); each batch's pickups are
// read off the field before that.

import { assertEqual, assertLength } from "../assert";
import { DROP_SAMPLE, PICKUP_KINDS, type PickupKind } from "../constants";
import {
  captureStill,
  enable,
  isolate,
  type GemSnapshot,
  type Harness,
  type PickupSnapshot,
  type Point,
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
}

/** A kill point's key, to the unit; points are 100 units apart. */
function keyOf(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

/**
 * Kill `DROP_SAMPLE` common enemies, each on its own point, and hand back what
 * their drop rolls left, keeping the final frame as the point's `outputId`
 * output. Nothing is posed for the rolls, so each is the build's own.
 */
export async function drawDrops(
  h: Harness,
  outputId: string,
): Promise<DropSample> {
  isolate(h);
  // The drop roll is the requirement this sample decides, so `drops` is the
  // one faculty turned back on.
  enable(h, "drops");
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

  return { kills: DROP_SAMPLE, pickups, counts, mostPerPoint, strays, after };
}

/** What one posed kill left. */
export interface Kill {
  /** Where the enemy stood, which is where its drops land. */
  at: Point;
  /** The state before the killing tick. */
  before: WickSnapshot;
  /** The state the killing tick left. */
  after: WickSnapshot;
  /** The gems the tick dropped. */
  gems: GemSnapshot[];
  /** The pickups the tick dropped. */
  pickups: PickupSnapshot[];
}

/**
 * Kill one enemy of `type` at `(dx, dy)` from the lamplighter by a posed
 * level-1 Ember bolt, on a night already posed, and read what the killing tick
 * dropped. The night's `drops` must be on for anything to land.
 */
export async function killOne(
  h: Harness,
  type: "moth" | "mothwing",
  dx: number,
  dy: number,
): Promise<Kill> {
  const at = armKill(h, type, dx, dy);
  const before = h.snapshot();
  const after = await h.tick(1);
  assertEqual(
    after.run.kills,
    before.run.kills + 1,
    `the kill the tick of the ${type} at (${at.x}, ${at.y}) made`,
  );
  const gemIds = new Set(before.run.gems.map((gem) => gem.id));
  const pickupIds = new Set(before.run.pickups.map((pickup) => pickup.id));
  return {
    at,
    before,
    after,
    gems: after.run.gems.filter((gem) => !gemIds.has(gem.id)),
    pickups: after.run.pickups.filter((pickup) => !pickupIds.has(pickup.id)),
  };
}
