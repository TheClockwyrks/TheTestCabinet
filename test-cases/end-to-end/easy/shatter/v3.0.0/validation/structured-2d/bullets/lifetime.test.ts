// bullets/lifetime — a round is removed once BULLET_LIFE has run out.
//
// specs/weapons.md, "The gun", the Lifetime row: "`BULLET_LIFE` (`1.5` seconds),
// after which the bullet is removed." specs/instrumentation.md gives a round
// placed through `addBullet` "a full `BULLET_LIFE`", so the clock starts at the
// pose and the removal is due `1.5` seconds of game time later.
//
// WHAT IS READ, AND WHY BOTH SIDES. Whether the round is still on the roster at
// `1.4` s and gone by `1.6` s — a tenth of a second either side of the figure.
// One side alone decides nothing: a build that removes a round the moment it is
// placed passes "gone by 1.6 s", and a build that never removes one passes "still
// there at 1.4 s". Together they place the removal inside a window `0.2` s wide
// around a `1.5` s figure, which separates it from every neighbouring round
// number a build might have picked and from the `1.4` s the saucer's own rounds
// live for (specs/saucer.md).
//
// THE TENTH OF A SECOND IS A READING ALLOWANCE, NOT ROOM ON THE FIGURE. A life
// counted down by `TICK_DT` a tick lands on the tick whose accumulated time first
// reaches `1.5` s, which floating-point addition can put a tick either side of
// tick 180; and a build is free to test its life before or after the tick's
// decrement, which is one more tick. Twelve ticks is far more than either needs
// and far less than the gap to any other figure.
//
// THE ROUND IS POSED CLEAR OF EVERYTHING, AND STAYS CLEAR. specs/collision.md
// removes a round that lands or that the core absorbs, so a round that met either
// would leave the roster for a reason that is not its life. `startPlaying` leaves
// no rock and no saucer on the field, and the round is posed along the bottom of
// the field travelling across it. The well does pull it (specs/gravity.md): from
// `330` units below the star that pull is `41` units per second squared, which
// even held at its full strength for the whole `1.6` s of this scenario carries
// the round `53` units toward the star — leaving it no nearer the core than
// `277` units, eight times the `33` at which a round and the core touch. Its own
// ship is no obstacle: specs/collision.md gives the ship and its own rounds no
// interaction at all.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_LIFE, MUZZLE_SPEED, STAR_X } from "../../src/constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The lane the round is flown along: below the star, across the field. */
const LANE_Y = 690;
const START_X = STAR_X;

/** When the round must still be in flight, and when it must be gone. */
const ALIVE_AT = BULLET_LIFE - 0.1;
const GONE_AT = BULLET_LIFE + 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a round in flight to 1.4 s of game time and removes it by 1.6 s", async () => {
  startPlaying(h);
  const id = poseBullet(h, START_X, LANE_Y, MUZZLE_SPEED, 0);

  await h.advance(ticksFor(ALIVE_AT));
  const early = h.snapshot();

  await h.advance(ticksFor(GONE_AT) - ticksFor(ALIVE_AT));
  const late = h.snapshot();
  // The field the instant after the round expired.
  captureStill(h, "expiry");

  assertTrue(
    early.bullets.some((bullet) => bullet.id === id),
    `the round still in flight at ${ALIVE_AT} s of game time, a tenth of a ` +
      `second short of BULLET_LIFE (${BULLET_LIFE} s) (specs/weapons.md); ` +
      `the roster held ${JSON.stringify(early.bullets.map((b) => b.id))}`,
  );
  assertTrue(
    !late.bullets.some((bullet) => bullet.id === id),
    `the round removed by ${GONE_AT} s of game time, a tenth of a second past ` +
      `BULLET_LIFE (${BULLET_LIFE} s) (specs/weapons.md); the roster held ` +
      `${JSON.stringify(late.bullets.map((b) => b.id))}`,
  );
});
