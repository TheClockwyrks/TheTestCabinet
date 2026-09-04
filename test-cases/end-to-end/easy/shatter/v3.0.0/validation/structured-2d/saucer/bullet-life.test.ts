// saucer/bullet-life — a saucer's round is taken off the field after
// SAUCER_BULLET_LIFE.
//
// THE RULE. `specs/saucer.md`, Firing: a saucer bullet "is removed
// `SAUCER_BULLET_LIFE` (`1.4` seconds) after it is fired".
// `specs/instrumentation.md` gives a round placed through `addEnemyBullet` "a full
// `SAUCER_BULLET_LIFE`", so the clock starts at the pose and the removal is due
// `1.4` s of game time later.
//
// WHY BOTH SIDES ARE READ. Whether the round is still on the roster at `1.3` s and
// gone by `1.5` s — a tenth of a second either side of the figure. One side alone
// decides nothing: a build that removes a round the moment it is placed passes
// "gone by 1.5 s", and a build that never removes one passes "still there at
// 1.3 s". Together they place the removal inside a window `0.2` s wide, which
// separates `1.4` from the `1.5` s the SHIP's rounds live for
// (`specs/weapons.md`) — the nearest other figure in the game, and exactly the one
// a build would reach for if it gave both rounds one lifetime.
//
// THE TENTH OF A SECOND IS A READING ALLOWANCE, NOT ROOM ON THE FIGURE. A life
// counted down by `TICK_DT` a tick lands on the tick whose accumulated time first
// reaches `1.4` s, which floating-point addition can put a tick either side of
// tick `168`; and a build is free to test its life before or after the tick's
// decrement, which is one more tick. Twelve ticks is far more than either needs.
//
// THE ROUND IS POSED CLEAR OF EVERYTHING, AND AT REST. `specs/collision.md`
// removes a saucer round that reaches the ship or the core, so a round that met
// either would leave the roster for a reason that is not its life. It is placed in
// the top-left corner, `653` units from the star, with no velocity of its own: the
// well is the only thing acting on it (`specs/saucer.md`: "It is pulled by the
// well"), and from rest that pull moves it `12` units over the whole `1.5` s — so
// it ends the scenario `641` units from a core it touches at `33`. Nothing else is
// on the field: `startPlaying` leaves no rock and no saucer, and shuts the ship's
// lethal contact test.
//
// WHAT THIS DOES NOT DECIDE. What a round does to what it hits, which is
// `saucer/bullet-harms-only-the-ship`'s and the `star-core` group's.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_BULLET_LIFE } from "../constants";
import { assertDefined, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBulletById,
  poseEnemyBullet,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the round is posed: the far corner, clear of everything. */
const POSE_X = 140;
const POSE_Y = 100;

/** The window the removal has to fall inside, in seconds of game time. */
const MARGIN = 0.1;
const ALIVE_AT = SAUCER_BULLET_LIFE - MARGIN;
const GONE_AT = SAUCER_BULLET_LIFE + MARGIN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a saucer round in flight to 1.3 s of game time and removes it by 1.5 s", async () => {
  startPlaying(h);
  const id = poseEnemyBullet(h, POSE_X, POSE_Y, 0, 0);

  await h.advance(ticksFor(ALIVE_AT));
  const early = h.snapshot();

  await h.advance(ticksFor(GONE_AT) - ticksFor(ALIVE_AT));
  const late = h.snapshot();
  // The field the instant after the enemy round expired.
  captureStill(h, "expiry");

  assertDefined(
    enemyBulletById(early, id),
    `saucer round ${id} still in flight at ${ALIVE_AT} s of game time, a ` +
      `tenth of a second short of SAUCER_BULLET_LIFE (${SAUCER_BULLET_LIFE} s) ` +
      `(specs/saucer.md); the roster held ` +
      `${JSON.stringify(early.enemyBullets.map((round) => round.id))}`,
  );
  assertUndefined(
    enemyBulletById(late, id),
    `saucer round ${id} removed by ${GONE_AT} s of game time, a tenth of a ` +
      `second past SAUCER_BULLET_LIFE (${SAUCER_BULLET_LIFE} s) ` +
      `(specs/saucer.md); the roster held ` +
      `${JSON.stringify(late.enemyBullets.map((round) => round.id))}`,
  );
});
