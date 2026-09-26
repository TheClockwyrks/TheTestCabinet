// pickups/sample — the handful of drop rolls the two `rollDrop` points read,
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
//   - specs/instrumentation.md ("Drawn outcomes"), `rollDrop(state)`: "Makes
//     one drop roll exactly as `specs/world.md` states under The drop roll and
//     returns what it decided: `bread`, `draft`, or `none`. It is a reading of
//     the roll alone".
//   - specs/instrumentation.md ("Drawn outcomes"), `setNextDrop(kind)`: "The
//     next common enemy killed by a weapon while `drops` is on drops that
//     pickup beside its gem, or nothing for `none`, in place of its roll, and
//     that kill consumes it."
//   - specs/world.md ("One tick", phase 6): "an enemy whose `hp` is at or
//     below `0` dies: its drop and its bread or draft land at its center", so
//     what a kill dropped is read off the field at the point that kill
//     happened.
//
// WHY THE SAMPLE IS A RUN OF ROLLS. The surface carries the roll on its own,
// so a sample is a caller's count of `rollDrop` calls against the engine's
// current state, each the build's own roll with nothing posed for it. The
// state the calls are made over is never changed by them, which
// `instrumentation/roll-drop-changes-nothing` decides; here each result is
// only counted. The probabilities themselves are the reviewer's to judge,
// since a sample a point could afford cannot tell `0.02` from its neighbours.

import { assertEqual } from "../assert";
import { NEXT_DROPS, type NextDrop } from "../constants";
import type {
  GemSnapshot,
  Harness,
  PickupSnapshot,
  Point,
  WickSnapshot,
} from "../harness";
import { armKill } from "./night";

/** What a sample of rolls decided. */
export interface RollSample {
  /** How many rolls were made. */
  rolls: number;
  /** How many rolls decided each kind. */
  counts: Readonly<Record<NextDrop, number>>;
  /** Every result outside `bread`, `draft`, and `none`, as the surface returned it. */
  others: unknown[];
}

/**
 * Make `rolls` drop rolls through `rollDrop` and hand back what they decided.
 * Nothing is posed for the rolls, so each is the build's own.
 */
export function rollDrops(h: Harness, rolls: number): RollSample {
  const counts: Record<NextDrop, number> = { bread: 0, draft: 0, none: 0 };
  const others: unknown[] = [];
  const kinds: readonly string[] = NEXT_DROPS;
  for (let i = 0; i < rolls; i += 1) {
    const rolled: unknown = h.debug.rollDrop();
    if (typeof rolled === "string" && kinds.includes(rolled)) {
      counts[rolled as NextDrop] += 1;
    } else {
      others.push(rolled);
    }
  }
  return { rolls, counts, others };
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
