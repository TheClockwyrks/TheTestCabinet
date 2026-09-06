// pickups/stage — the drop rolls the rate checks in this directory read, and
// the one posed kill the drop checks read.
//
// WHAT THE RATE CHECKS SHARE. specs/world.md ("The drop roll") states the rule
// as a probability: "each common enemy killed by a weapon rolls for a pickup on
// the tick it dies ... The roll drops bread with probability `BREAD_CHANCE`,
// and only when it dropped no bread it drops a draft with probability
// `DRAFT_CHANCE`." A probability is only readable over a sample, and the
// surface carries the roll on its own: `rollDrop()` "Makes one drop roll
// exactly as `specs/world.md` states under The drop roll and returns what it
// decided: `bread`, `draft`, or `none`. It is a reading of the roll alone"
// (specs/instrumentation.md, "Drawn outcomes"). So `bread-rate` and
// `draft-rate` each read the same sample, `DROP_ROLLS` (`40000`) rolls made
// through {@link rollDrops}, and count a different kind off it. Every sample
// size and every bound the counts are held to is `constants.ts`'s, computed
// from the two probabilities.
//
// The rolls of a sample go into the page in one evaluation rather than one
// crossing each. They are the build's own `window.__wick.rollDrop`, called the
// way any caller would call it, exactly as `bracket` in `../harness` calls one
// operation; what a single evaluation saves is forty thousand round trips.
//
// WHAT THE POSED CHECKS SHARE. The same file has `setNextDrop(kind)` decide
// what "the next common enemy killed by a weapon while `drops` is on drops ...
// in place of its roll" (specs/instrumentation.md, "Drawn outcomes"), so
// `bread-drops`, `drafts-drop`, and `elites-make-no-draw` pose the outcome
// through {@link killCommon} and read one kill rather than a sample.
//
// WHERE A KILL HAPPENS. A kill is a real one: a moth posed at its own point
// and a level-1 Ember bolt posed on its center, so the next tick's phase 6
// takes the moth below `0` and the kill rolls. `killPoint` names distinct
// points `POINT_SPACING` (`60`) units apart, wider than an Ember bolt's `8`
// plus a moth's `10`, so each bolt reaches its own moth alone; every point is
// at least `FIRST_COLUMN` (`500`) units from the lamplighter, far outside both
// `PICKUP_RADIUS` (`48`) and the pickup collection distance (`28`), so nothing
// a kill drops is attracted or collected; and `killPoint` is one-to-one, so a
// pickup's center names the kill that dropped it.

import { assertEqual } from "../assert";
import { DROP_ROLLS, HANDLE, NEXT_DROPS, type NextDrop } from "../constants";
import type { Harness, PickupView, WickSnapshot, XY } from "../harness";
import { newGems, newPickups, placeEnemy, placeProjectile } from "../harness";

/** The common enemy each kill is: the lightest in specs/enemies.md, at `5` hp. */
export const KILL_ENEMY = "moth";

/** The weapon each kill is made by: a level-1 Ember bolt carries `10` damage. */
export const KILL_WEAPON = "ember";

/** How many kill points share one row of `killPoint`'s grid. */
const POINTS_PER_ROW = 100;

/** The nearest column of kill points to the lamplighter, in units. */
const FIRST_COLUMN = 500;

/** Units between two kill points, wider than a bolt's radius plus a moth's. */
const POINT_SPACING = 60;

/** Where the kill with index `k` happens. */
export function killPoint(k: number): XY {
  return {
    x: FIRST_COLUMN + (k % POINTS_PER_ROW) * POINT_SPACING,
    y: Math.floor(k / POINTS_PER_ROW) * POINT_SPACING,
  };
}

/** What a sample of rolls decided. */
export interface RollSample {
  /** How many rolls were made. */
  rolls: number;
  /** How many rolls decided each kind. */
  counts: Record<NextDrop, number>;
  /** Every result outside `bread`, `draft`, and `none`, as the surface returned it. */
  others: unknown[];
}

/**
 * Make `rolls` drop rolls through the surface's `rollDrop()`, in one
 * evaluation, and hand back what they decided.
 *
 * Nothing is posed for the rolls, so each is the build's own; the world the
 * caller stands on is left exactly as it was, which is the surface's own rule
 * for the reading and `instrumentation/roll-drop-changes-nothing` decides it.
 */
export async function rollDrops(
  h: Harness,
  rolls: number = DROP_ROLLS,
): Promise<RollSample> {
  return h.page.evaluate(
    ([handle, count, kinds]) => {
      const api = (
        window as unknown as Record<
          string,
          Record<string, (...a: unknown[]) => unknown>
        >
      )[handle];
      if (api === undefined) {
        throw new Error(`wick: the surface ${handle} is not installed`);
      }
      const counts = { bread: 0, draft: 0, none: 0 };
      const others: unknown[] = [];
      for (let i = 0; i < count; i += 1) {
        const rolled = api.rollDrop!();
        if ((kinds as readonly string[]).includes(rolled as string)) {
          counts[rolled as keyof typeof counts] += 1;
        } else {
          others.push(rolled);
        }
      }
      return { rolls: count, counts, others };
    },
    [HANDLE, rolls, NEXT_DROPS] as const,
  );
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
