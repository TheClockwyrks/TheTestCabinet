// instrumentation — the one populated field the five "leaves the rest standing"
// items are decided over. LOCAL TO THIS GROUP.
//
// `clearRocks`, `clearBullets`, `clearEnemyBullets`, `clearTorpedoes` and
// `removeSaucer` each carry the same second half in `specs/instrumentation.md`:
// the roster it names is emptied and EVERY OTHER ROSTER IS LEFT STANDING. So each
// of those items needs one field carrying something on every roster at once, and
// the five read better against each other when it is the same field every time.
//
// IT HOLDS NO THRESHOLD AND MAKES NO ASSERTION. What is here is placement: where
// the bodies stand, chosen so that nothing in the pose can decide an item by
// accident. Every body is
//
//   - AT REST, so nothing has to be read at a moment; a check poses, clears, and
//     reads, and the numbers it reads are the numbers it wrote;
//   - CLEAR OF THE STAR'S WHOLE DRAWN EXTENT and far enough out that the well
//     moves nothing appreciably over the single tick a still is drawn from;
//   - CLEAR OF EVERY OTHER BODY by more than the sum of any two collision radii,
//     so the build's own collision pass has nothing to resolve and no clear can be
//     confused with a hit;
//   - SPREAD ACROSS THE FIELD, so the captured still shows a reviewer at a glance
//     which rosters survived.
//
// The saucer is posed with all three faculties off. It is a bystander here rather
// than the subject, and a saucer that steered, fired and travelled would put
// enemy bullets on a field whose enemy-bullet roster is exactly what two of these
// items count.

import { poseBullet, poseEnemyBullet, poseRock, poseSaucer } from "../harness";
import type { Harness } from "../harness";

/** Where the two rocks stand: opposite top corners, well clear of the star. */
export const ROCK_PLACES = [
  { size: "large", x: 180, y: 180 },
  { size: "medium", x: 1100, y: 180 },
] as const;

/** Where the two of the ship's bullets sit. */
export const BULLET_PLACES = [
  { x: 180, y: 560 },
  { x: 400, y: 660 },
] as const;

/** Where the two saucer bullets sit. */
export const ENEMY_BULLET_PLACES = [
  { x: 1100, y: 560 },
  { x: 880, y: 660 },
] as const;

/** Where the saucer hangs: on the star's column, but 260 units above its centre. */
export const SAUCER_PLACE = { x: 640, y: 100 } as const;

/** Everything the posed field holds, by id, in the order it was posed. */
export interface PopulatedField {
  rocks: number[];
  bullets: number[];
  enemyBullets: number[];
  saucer: number;
}

/**
 * Pose two rocks, two of the ship's bullets, two saucer bullets and one saucer on
 * an otherwise empty, quiet, live field, and hand back every id.
 *
 * The caller has already called {@link startPlaying}; this adds the bodies and
 * nothing else.
 */
export async function posePopulatedField(h: Harness): Promise<PopulatedField> {
  const rocks: number[] = [];
  for (const place of ROCK_PLACES) {
    rocks.push(await poseRock(h, place.size, place.x, place.y));
  }
  const bullets: number[] = [];
  for (const place of BULLET_PLACES) {
    bullets.push(await poseBullet(h, place.x, place.y, 0, 0));
  }
  const enemyBullets: number[] = [];
  for (const place of ENEMY_BULLET_PLACES) {
    enemyBullets.push(await poseEnemyBullet(h, place.x, place.y, 0, 0));
  }
  const saucer = await poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y, {
    vx: 0,
    vy: 0,
    mind: false,
    gun: false,
    travel: false,
  });
  return { rocks, bullets, enemyBullets, saucer };
}
