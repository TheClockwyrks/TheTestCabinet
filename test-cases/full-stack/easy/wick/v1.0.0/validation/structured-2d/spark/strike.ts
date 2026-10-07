// Wick — spark/strike: one posed Spark firing, shared by the checks in this
// directory. CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. Spark lands its strikes "on random enemies
// within `SPARK_RANGE`" and needs a target "within `SPARK_RANGE`"
// (`specs/weapons.md`, Targeting summary), so every check on a strike poses an
// isolated run, stands some enemies in the world, holds Spark at the level
// under test, and runs the one tick on which it fires. That arrangement is
// spelled once here and decides nothing: the enemies are placed through the
// surface's real spawn path, Spark through `setWeapon`, the firing through
// `setWeaponCooldown(slot, 0)` and `weaponFire` on
// ("`setWeaponCooldown(slot, 0)` makes that the next tick",
// `specs/instrumentation.md`), and what the tick created is read back by id,
// telling this tick's strikes from anything posed before it.
//
// WHERE THE ENEMIES STAND. Each post is `POST_DISTANCE` (300) units from the
// origin, where the lamplighter stands in an isolated run, in a direction of
// its own, ninety degrees apart. 300 is inside `SPARK_RANGE` (600) by a wide
// margin, so every post is an eligible target, and two posts are at least
// `300 × sqrt(2)` (about 424) units apart, farther than the largest `area`
// any row gives (70), so a strike on one post's enemy reaches no other post
// ("every other enemy within `area` of the target's center",
// `specs/weapons.md`, Spark). A strike's zone is centered on its target
// ("Every zone's position is the center of its shape", and a strike's `x`,
// `y` is the target's center under Snapshot shape), so a zone names its
// target by its center alone. `enemyMotion` is off, so the enemies stand
// where they were posed on the firing tick, and `enemyContact` is off, so
// none of them hits the lamplighter.
//
// HOW A HIT IS READ. `specs/weapons.md` ("Hits and death"): "A hit removes
// the shape's damage per hit from the enemy's `hp`", and "On any tick an
// enemy's `hp` is at or below `0` after the hits the enemy dies on that
// tick". A moth has 5 hp (`specs/enemies.md`) and every Spark row deals at
// least 15, so a moth a strike reaches dies on the landing tick and is gone
// from `enemies`; a build that lowered its `hp` without removing it has
// landed the hit all the same, and whether a dead enemy is removed is the
// death checks' point. A hound has 120 hp, more than the 40 of row 8, so a
// hound a strike reaches keeps living at `hp` less the damage, which is how a
// row's damage is read off a target. An enemy a strike did not reach keeps
// exactly the `hp` it was posed with: `enemyMotion`, `enemyContact`, and
// `despawning` are off in every isolated run, so nothing but the strike can
// touch it and nothing can remove it.

import { REAL_EPS, type EnemyId } from "../constants";
import {
  advanceTicks,
  armWeapon,
  enemyById,
  holdWeapon,
  isolate,
  placeEnemyNear,
  zonesCreatedSince,
  type Harness,
  type Point,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";

/** How far from the lamplighter each post stands: inside `SPARK_RANGE`. */
export const POST_DISTANCE = 300;

/**
 * Four posts `POST_DISTANCE` out, ninety degrees apart: right, down, left,
 * up. Row 8's amount of 4 is the most strikes one firing lands, so four
 * posts serve every row.
 */
export const TARGET_POSTS: readonly Point[] = [
  { x: POST_DISTANCE, y: 0 },
  { x: 0, y: POST_DISTANCE },
  { x: -POST_DISTANCE, y: 0 },
  { x: 0, y: -POST_DISTANCE },
];

/** What one posed firing tick left. */
export interface Firing {
  /** The slot Spark was placed in. */
  slot: number;
  /** The enemies' ids, in the order their posts were given. */
  targets: number[];
  /** The `hp` each enemy held before the firing tick, in the same order. */
  hpBefore: number[];
  /** The state before the firing tick, with Spark armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The strike zones the firing tick created, in id order. */
  strikes: SnapshotZone[];
}

/**
 * Pose an isolated run with one enemy of `type` at each of `posts`, hold
 * Spark at `level` armed to fire on the next tick, run that one tick, and
 * read what it left.
 *
 * `isolate` first, so the run holds nothing but what is placed here: no other
 * weapon (Taper removed), no passive, every driver switch off but the
 * `weaponFire` that `armWeapon` turns on. `posts` are offsets from the
 * lamplighter's center, which is the origin in an isolated run.
 */
export async function fireSpark(
  h: Harness,
  level: number,
  posts: readonly Point[],
  type: EnemyId = "moth",
): Promise<Firing> {
  isolate(h);
  const targets = posts.map((post) => placeEnemyNear(h, type, post.x, post.y));
  const slot = holdWeapon(h, "spark", level);
  armWeapon(h, slot);
  const before = h.snapshot();
  const hpBefore = targets.map((id) => hpOf(before, id));
  const after = await advanceTicks(h, 1);
  return {
    slot,
    targets,
    hpBefore,
    before,
    after,
    strikes: zonesCreatedSince(before, after).filter(
      (zone) => zone.kind === "strike",
    ),
  };
}

/** What the firing tick did to a posed enemy. */
export type EnemyOutcome = "hit" | "untouched";

/**
 * Whether the tick that ran hit enemy `id`, whose `hp` read `hpBefore` before
 * it: `"hit"` when the enemy is gone or its `hp` fell, `"untouched"` when it
 * is still there at the `hp` it was posed with.
 */
export function enemyOutcome(
  after: WickSnapshot,
  id: number,
  hpBefore: number,
): EnemyOutcome {
  const enemy = enemyById(after, id);
  if (enemy === undefined) return "hit";
  return enemy.hp < hpBefore - REAL_EPS ? "hit" : "untouched";
}

/** The `hp` enemy `id` holds in `s`; a missing enemy fails the check. */
export function hpOf(s: WickSnapshot, id: number): number {
  const enemy = enemyById(s, id);
  if (enemy === undefined) {
    throw new Error(`Expected: a live enemy with id ${id}\nActual: none`);
  }
  return enemy.hp;
}

/**
 * The index of the post `zone` is centered on, within `REAL_EPS` on each
 * axis, or `-1` when it is centered on none of them. `posts` are offsets from
 * `origin`, the lamplighter's center the enemies were placed about.
 */
export function postOf(
  zone: Point,
  posts: readonly Point[],
  origin: Point,
): number {
  return posts.findIndex(
    (post) =>
      Math.abs(zone.x - (origin.x + post.x)) <= REAL_EPS &&
      Math.abs(zone.y - (origin.y + post.y)) <= REAL_EPS,
  );
}
