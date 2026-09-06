// pickups/stage — the common kills the drop checks in this directory read.
//
// WHAT THE RATE CHECKS SHARE. specs/world.md ("The drop roll") states the rule
// as a probability: "each common enemy killed by a weapon rolls for a pickup on
// the tick it dies ... The roll drops bread with probability `BREAD_CHANCE`,
// and only when it dropped no bread it drops a draft with probability
// `DRAFT_CHANCE`." A probability is only readable over a sample, so
// `bread-rate` and `draft-rate` each pose the same sample, `DROP_ROLL_KILLS`
// (`4000`) common kills at distinct points, and read a different count off it.
// Every sample size and every bound the counts are held to is `constants.ts`'s,
// computed from the two probabilities.
//
// WHAT THE POSED CHECKS SHARE. The same file has `setNextDrop(kind)` decide
// what "the next common enemy killed by a weapon while `drops` is on drops ...
// in place of its roll" (specs/instrumentation.md, "Drawn outcomes"), so
// `bread-drops`, `drafts-drop`, and `elites-make-no-draw` pose the outcome
// through {@link killCommon} and read one kill rather than a sample.
//
// WHY THE KILLS ARE POSED IN ROUNDS. Every kill is a real one: a moth posed at
// its own point and a level-1 Ember bolt posed on its center, so the next tick's
// phase 6 takes the moth below `0` and the kill rolls. A kill a tick would be a
// tick a kill; the rule does not care how many ticks the kills are spread over,
// so a round poses `ROUND_KILLS` (`100`) of them at once and one tick resolves
// all hundred. The points of a round are `POINT_SPACING` (`60`) units apart,
// wider than an Ember bolt's `8` plus a moth's `10`, so each bolt reaches its
// own moth alone; every point is at least `FIRST_COLUMN` (`500`) units from the
// lamplighter, far outside both `PICKUP_RADIUS` (`48`) and the pickup
// collection distance (`28`), so nothing a kill drops is attracted or
// collected; and `killPoint` is one-to-one, so a pickup's center names the kill
// that dropped it.
//
// The poses of a round go into the page in one evaluation rather than one
// crossing each. They are the build's own `window.__wick` operations, called in
// the order a caller would call them in, exactly as `bracket` in `../harness`
// calls one; what a single evaluation saves is four thousand round trips.
//
// WHY THE FIELD IS SWEPT BETWEEN ROUNDS. `clearGems` and `clearPickups` remove
// what a round dropped without collecting anything, so the snapshot a round is
// read from holds that round's drops alone and the state does not grow to a
// sample's worth of gems.

import { assertEqual } from "../assert";
import { DROP_ROLL_KILLS, HANDLE, type PickupKind } from "../constants";
import type { Harness, PickupView, WickSnapshot, XY } from "../harness";
import {
  isolate,
  newGems,
  newPickups,
  placeEnemy,
  placeProjectile,
} from "../harness";

/** The common enemy each kill is: the lightest in specs/enemies.md, at `5` hp. */
export const KILL_ENEMY = "moth";

/** The weapon each kill is made by: a level-1 Ember bolt carries `10` damage. */
export const KILL_WEAPON = "ember";

/** Kills posed per tick. */
export const ROUND_KILLS = 100;

/** The nearest column of kill points to the lamplighter, in units. */
const FIRST_COLUMN = 500;

/** Units between two kill points, wider than a bolt's radius plus a moth's. */
const POINT_SPACING = 60;

/** Where the kill with index `k` in the sample happens. */
export function killPoint(k: number): XY {
  return {
    x: FIRST_COLUMN + (k % ROUND_KILLS) * POINT_SPACING,
    y: Math.floor(k / ROUND_KILLS) * POINT_SPACING,
  };
}

/** What one round of kills dropped. */
export interface KillRound {
  /** The points the round's kills happened at, in kill order. */
  points: XY[];
  /** The pickups the round's tick left on the field. */
  pickups: PickupView[];
}

/** The whole sample, and the counts read off it. */
export interface KillSweep {
  /** Each round, in order. */
  rounds: KillRound[];
  /** The kills the sweep made, which the sweep itself holds to the sample size. */
  kills: number;
  /** How many pickups of each kind the sample dropped. */
  counts: Record<PickupKind, number>;
}

/** Pose `points` as a moth apiece with a bolt on its center, in one evaluation. */
async function poseKills(h: Harness, points: readonly XY[]): Promise<void> {
  await h.page.evaluate(
    ([handle, type, weapon, list]) => {
      const api = (
        window as unknown as Record<
          string,
          Record<string, (...a: unknown[]) => unknown>
        >
      )[handle];
      if (api === undefined) {
        throw new Error(`wick: the surface ${handle} is not installed`);
      }
      for (const point of list as readonly { x: number; y: number }[]) {
        api.spawnEnemy!(type, point.x, point.y);
        api.spawnProjectile!(weapon, point.x, point.y, 0, 0, 0);
      }
    },
    [HANDLE, KILL_ENEMY, KILL_WEAPON, points] as const,
  );
}

/**
 * Open an isolated night and kill `kills` commons in it, a round to a tick, and
 * hand back what they dropped.
 *
 * The night is `isolate`'s with `drops` turned back on, which is the faculty
 * these checks read: every other driver switch is off and no slot is held, so
 * `spawning` and `events` bring nothing in, no weapon of the lamplighter's own
 * fires, and the only rolls the ticks make are the kills' own.
 */
export async function sweepCommonKills(
  h: Harness,
  kills: number = DROP_ROLL_KILLS,
): Promise<KillSweep> {
  await isolate(h, { on: ["drops"] });
  const rounds: KillRound[] = [];
  const counts: Record<PickupKind, number> = { chest: 0, bread: 0, draft: 0 };
  let made = 0;
  for (let from = 0; from < kills; from += ROUND_KILLS) {
    const size = Math.min(ROUND_KILLS, kills - from);
    const points = Array.from({ length: size }, (_, i) => killPoint(from + i));
    const before = await h.snapshot();
    await poseKills(h, points);
    const after = await h.step(1);
    assertEqual(
      after.run.kills - before.run.kills,
      size,
      `the kills the tick of round ${rounds.length} made`,
    );
    assertEqual(
      after.run.enemies.length,
      0,
      `the enemies left alive after round ${rounds.length}`,
    );
    made += size;
    const pickups = after.run.pickups;
    for (const pickup of pickups) counts[pickup.kind] += 1;
    rounds.push({ points, pickups });
    await h.debug.clearGems();
    await h.debug.clearPickups();
  }
  return { rounds, kills: made, counts };
}

/** What one posed kill left. */
export interface Kill {
  /** Where the enemy stood, which is where its drops land. */
  at: XY;
  /** The state before the killing tick. */
  before: WickSnapshot;
  /** The state the killing tick left. */
  after: WickSnapshot;
  /** The gems the tick dropped. */
  gems: ReturnType<typeof newGems>;
  /** The pickups the tick dropped. */
  pickups: PickupView[];
}

/**
 * Kill one enemy of `type` at `at` by a level-1 Ember bolt on its center, on a
 * night already posed, and read what the killing tick dropped. An elite's
 * health is posed down first, since one bolt does not end it.
 */
export async function killCommon(
  h: Harness,
  type: "moth" | "mothwing",
  at: XY,
): Promise<Kill> {
  const enemy = await placeEnemy(h, type, at.x, at.y);
  if (type === "mothwing") await h.debug.setEnemyHp(enemy.id, 1);
  await placeProjectile(h, KILL_WEAPON, at.x, at.y, 0, 0, 0);
  const before = await h.snapshot();
  const after = await h.step(1);
  assertEqual(
    after.run.kills,
    before.run.kills + 1,
    `the kill the tick of the ${type} at (${at.x}, ${at.y}) made`,
  );
  return {
    at,
    before,
    after,
    gems: newGems(before, after),
    pickups: newPickups(before, after),
  };
}
