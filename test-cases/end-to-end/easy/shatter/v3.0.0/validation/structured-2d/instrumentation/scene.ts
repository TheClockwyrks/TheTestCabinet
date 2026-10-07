// Shatter — the populated field this group's roster checks are read off.
//
// GROUP-LOCAL, and deliberately not in the harness: only the Instrumentation
// checks want a field carrying one of everything at once. Every other group
// poses the one thing its requirement is about.
//
// WHAT IT IS FOR. Eight of this group's items are about a roster operation
// leaving the OTHER rosters alone — the three `clearX`, the three `removeX`,
// `removeSaucer`, and (under `warhead`) `clearTorpedoes` — and each of them
// needs a field where every roster is non-empty at once, so "the rest standing"
// is a reading rather than a vacuous truth. `snapshot-shape` and `entity-ids`
// want the same field for a different reason: every branch of the reported
// shape present at one instant.
//
// WHAT MAKES IT SAFE TO READ OFF. Nothing on it can change anything else on it:
//
// - EVERY BODY IS AT REST and stands clear of every other by far more than the
//   sum of their radii (`specs/collision.md`), so no pair of them touches and
//   no swept path crosses.
// - NOTHING IS WITHIN REACH OF THE CORE. The nearest body is `300` units from
//   `(STAR_X, STAR_Y)`, where the core's absorption radius is `CORE_R` (`30`)
//   plus the body's own (`specs/collision.md`), so nothing is swallowed.
// - THE SAUCER'S THREE FACULTIES ARE OFF. Its mind, its gun and its travel are
//   each their own switch (`specs/instrumentation.md`), and a saucer that
//   steered, fired or moved would write the very rosters these checks compare.
// - THE FIELD IS QUIET. `startPlaying` shuts both world gates and the ship's
//   lethal contact test first, so no wave lands on the reading and no saucer
//   wanders in beside the posed one.
//
// It fixes ARRANGEMENT alone. Not one figure below is a bound a check asserts:
// every threshold stays in the check that asserts it.

import {
  poseBullet,
  poseEnemyBullet,
  poseRock,
  poseSaucer,
  startPlaying,
  type Harness,
  type RockSize,
} from "../harness";

/** Where each rock stands, one of every size `specs/rocks.md` names. */
export const ROCK_SPOTS: Readonly<Record<RockSize, { x: number; y: number }>> =
  {
    large: { x: 200, y: 180 },
    medium: { x: 200, y: 560 },
    small: { x: 1080, y: 180 },
  };

/** Where the ship's three rounds hang, strung along the bottom of the field. */
export const BULLET_SPOTS: readonly { x: number; y: number }[] = [
  { x: 420, y: 660 },
  { x: 640, y: 660 },
  { x: 860, y: 660 },
];

/** Where the saucer's three rounds hang, strung along the top. */
export const ENEMY_BULLET_SPOTS: readonly { x: number; y: number }[] = [
  { x: 420, y: 60 },
  { x: 640, y: 60 },
  { x: 860, y: 60 },
];

/** Where the saucer sits, held still with all three faculties off. */
export const SAUCER_SPOT = { x: 1080, y: 560 } as const;

/** The sizes, in the order the rocks are posed. */
export const SIZES: readonly RockSize[] = ["large", "medium", "small"];

/** Every id the posed field handed out, by roster. */
export interface PopulatedField {
  /** One rock of each size, by size. */
  rocks: Record<RockSize, number>;
  /** The ship's three rounds, in roster order. */
  bullets: number[];
  /** The saucer's three rounds, in roster order. */
  enemyBullets: number[];
  /** The one saucer. */
  saucer: number;
}

/**
 * A quiet, still field carrying one rock of each size, three of the ship's
 * rounds, three of the saucer's, and a saucer with every faculty held.
 *
 * No frame is advanced: under this engine a pose acts on the live game at the
 * moment of the call (`specs/instrumentation.md`), so the field is standing when
 * this returns and a check reads it with nothing having run.
 */
export function posePopulatedField(h: Harness): PopulatedField {
  startPlaying(h);

  const rocks = {} as Record<RockSize, number>;
  for (const size of SIZES) {
    rocks[size] = poseRock(h, size, ROCK_SPOTS[size].x, ROCK_SPOTS[size].y);
  }

  const bullets = BULLET_SPOTS.map((at) => poseBullet(h, at.x, at.y, 0, 0));
  const enemyBullets = ENEMY_BULLET_SPOTS.map((at) =>
    poseEnemyBullet(h, at.x, at.y, 0, 0),
  );

  const saucer = poseSaucer(h, SAUCER_SPOT.x, SAUCER_SPOT.y);
  // Each faculty is its own switch (`specs/instrumentation.md`). All three off,
  // the saucer neither steers, shoots nor moves, so nothing it decides can
  // write a roster one of these checks is holding still.
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);
  h.debug.setSaucerTravel(false);

  return { rocks, bullets, enemyBullets, saucer };
}
