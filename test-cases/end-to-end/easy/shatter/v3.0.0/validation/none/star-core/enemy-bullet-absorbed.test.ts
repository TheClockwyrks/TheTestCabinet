// star-core/enemy-bullet-absorbed — the core swallows the saucer's round too.
//
// THE RULE. `specs/collision.md` gives the saucer's round its own row against the
// core — "A saucer bullet and the core — The bullet is absorbed and removed" — and
// it is a separate row for a reason. The two rosters are separate everywhere else
// in the specification: a saucer bullet passes over a rock the ship's bullet
// destroys, it is lethal to the ship the ship's own round is harmless to, and it is
// worth no score at all. A build that resolved the core against `bullets` alone
// would leave enemy fire streaming through the star, and every other rule about
// enemy fire would still hold.
//
// SO THIS IS THE SAME EVENT AS `star-core/bullet-absorbed` ON THE OTHER ROSTER, and
// it is its own item for exactly that reason: a build with one wired and the other
// not grades differently from a build with neither.
//
// NOTHING ABOUT THE SCORE IS READ HERE. `specs/collision.md` gives the saucer's
// round no scoring row against anything, so there is no wrong model to catch: the
// item is the removal.
//
// WHY THE ROUND CANNOT BE REMOVED BY ANYTHING ELSE. `startPlaying` has emptied
// every roster and shut both world gates, so the core is the only body it can
// reach — the saucer that would normally have fired it is not on the field, and no
// saucer can arrive. The flight is `ABSORB_TICKS`, well under the
// `SAUCER_BULLET_LIFE` (`1.4`) seconds `specs/saucer.md` gives the round, so an
// empty roster is the star's doing and not the clock's.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  CORE_R,
  SAUCER_BULLET_R,
  SAUCER_BULLET_SPEED,
  STAR_X,
  STAR_Y,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseEnemyBullet,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How far outside the core's surface the round begins: `120` units.
 *
 * Geometry, not a tolerance — the same standoff `star-core/bullet-absorbed` uses,
 * so the two rosters are put to the same approach and only the roster differs.
 */
const APPROACH = 120;

/** Where the round starts: due left of the star, aimed at its centre. */
const FROM = { x: STAR_X - CORE_R - SAUCER_BULLET_R - APPROACH, y: STAR_Y };

/**
 * The ticks the round is given to arrive: `0.45` seconds.
 *
 * `APPROACH / SAUCER_BULLET_SPEED` is `0.4` seconds and the well only shortens it,
 * so this is the flight with headroom. It is under a third of `SAUCER_BULLET_LIFE`,
 * which is what makes an empty roster mean absorption rather than expiry.
 */
const ABSORB_TICKS = ticksFor(0.45);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a saucer round driven into the core", async () => {
  await startPlaying(h);
  await poseEnemyBullet(h, FROM.x, FROM.y, SAUCER_BULLET_SPEED, 0);

  await h.advance(ABSORB_TICKS);
  const absorbed = await h.snapshot();
  await captureStill(h, "absorbed");

  assertLength(
    absorbed.enemyBullets,
    0,
    "the saucer bullets still in flight after one was driven into the core (specs/collision.md)",
  );
});
