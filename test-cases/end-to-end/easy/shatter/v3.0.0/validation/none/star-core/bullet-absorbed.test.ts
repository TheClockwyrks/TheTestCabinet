// star-core/bullet-absorbed — the core swallows a round, and pays nothing for it.
//
// THE RULE. `specs/collision.md`, the pair table: "A bullet and the core — The
// bullet is absorbed and removed. Nothing scores." `specs/field.md` says the same
// thing from the star's side: the core is "the one physical boundary on the field:
// a shot that reaches it is absorbed". So a round driven at the star's centre ends
// its flight there, the roster it was in is left empty, and the score stands where
// it was.
//
// WHY BOTH READINGS BELONG TO ONE ITEM. The specification's row states two things
// about the same event, and the second is the one a build gets wrong by accident:
// the natural way to reach "the bullet is removed" is to route the core through
// whatever removes a bullet that hit a rock, and that pays `SCORE_LARGE` or
// worse for hitting the star. A player who could farm the star for points has a
// different game. The removal alone would not catch it, so both are read on the
// tick the round is gone.
//
// WHY THE ROUND CANNOT BE REMOVED BY ANYTHING ELSE. `startPlaying` has emptied
// every roster and shut both world gates, so the core is the only body on the field
// the round can reach; and the whole flight is `ABSORB_TICKS`, a quarter of a
// second, against the `BULLET_LIFE` (`1.5`) seconds `specs/weapons.md` gives a
// round to live — so a build whose bullets expire on time still has this one in
// flight when the reading is taken, and a roster that is empty is empty because the
// star took it.
//
// THE APPROACH IS RADIAL, so the well `specs/gravity.md` fixes acts exactly along
// the flight and can only bring the round in sooner. Nothing about the path is
// asserted here: `gravity/bullet-curves` grades what the well does to a round, and
// this grades only what the core does to one that arrives.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BULLET_R, CORE_R, MUZZLE_SPEED, STAR_X, STAR_Y } from "../constants";
import {
  captureStill,
  createHarness,
  poseBullet,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How far outside the core's surface the round begins: `120` units.
 *
 * Geometry, not a tolerance. Far enough out that the whole flight is a real
 * approach the build's own collision pass has to resolve rather than an overlap
 * this pose created, and near enough that the flight is a fifth of a second at
 * `MUZZLE_SPEED` — nowhere near the life a round is given.
 */
const APPROACH = 120;

/** Where the round starts: due right of the star, aimed at its centre. */
const FROM = { x: STAR_X + CORE_R + BULLET_R + APPROACH, y: STAR_Y };

/**
 * The ticks the round is given to arrive: a quarter of a second.
 *
 * `APPROACH / MUZZLE_SPEED` is `0.231` seconds, and the well only shortens it, so
 * this is the flight with a tick or two of headroom. It is a sixth of `BULLET_LIFE`,
 * which is what makes an empty roster mean absorption rather than expiry.
 */
const ABSORB_TICKS = ticksFor(0.25);

/** The score a game that has destroyed nothing stands at (`specs/scoring.md`). */
const NOTHING_SCORED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a round driven into the core, and scores nothing for it", async () => {
  await startPlaying(h);
  await poseBullet(h, FROM.x, FROM.y, -MUZZLE_SPEED, 0);

  await h.advance(ABSORB_TICKS);
  const absorbed = await h.snapshot();
  await captureStill(h, "absorbed");

  assertLength(
    absorbed.bullets,
    0,
    "the ship's bullets still in flight a quarter of a second after one was driven into the core (specs/collision.md)",
  );
  assertEqual(
    absorbed.score,
    NOTHING_SCORED,
    "the score after a round was absorbed by the core (specs/collision.md)",
  );
});
