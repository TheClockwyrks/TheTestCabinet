// saucer/bullet-life — a saucer's round expires after 1.4 seconds.
//
// THE RULE. `specs/saucer.md`: a saucer bullet "is removed `SAUCER_BULLET_LIFE`
// (`1.4` seconds) after it is fired", and `specs/instrumentation.md` has
// `addEnemyBullet` put one up "with a full `SAUCER_BULLET_LIFE`". So a round
// posed here has the whole of it ahead of it, and the reading is a bracket around
// the moment it runs out: in flight at `1.3` s, gone by `1.5` s.
//
// A TENTH OF A SECOND EITHER SIDE, which is seven percent of the figure and the
// item's own. The clock is a count of ticks, so nothing conformant needs any of
// it; what it fails is every neighbouring figure — the ship's own `BULLET_LIFE`
// of `1.5` seconds is over the ceiling, and the `1.0`-second weave interval is
// well under the floor.
//
// CLEAR OF EVERYTHING, WHICH IS THE WHOLE POINT OF THE POSE. The round has to
// leave because its clock ran out and for no other reason, so `startPlaying`
// empties every roster and the round is flown along `y = 700` — the bottom of the
// field, `340` units below the star's row — from `x = 60`. Over the `1.5` seconds
// it covers `450` units, ending near `x = 510`, and the whole of that lane holds
// it more than three hundred units from the star's centre, so
// `specs/collision.md`'s core never absorbs it, and more than a hundred and
// eighty from the ship at the safe point, whose contact test `startPlaying` has
// switched off in any case. There is no rock, no saucer and no other round on the
// field for it to meet.
//
// THE READING IS THE WHOLE ROSTER, which on this field says exactly one thing:
// `startPlaying` emptied it and no saucer is up to add to it, so the roster holds
// this round and nothing else while the round lives and nothing at all once it
// has gone.
//
// The well does pull it (`specs/gravity.md` pulls every saucer bullet), which is
// exactly as it should be: the lane is chosen so that the drift the pull adds
// cannot carry it into anything, not so that the pull is switched off.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_BULLET_LIFE, SAUCER_BULLET_SPEED } from "../constants";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseEnemyBullet,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the round is posed: the bottom lane, near the left edge. */
const START = { x: 60, y: 700 };

/** A tenth of a second either side of `SAUCER_BULLET_LIFE`, the item's bracket. */
const BRACKET = 0.1;

/** The moment it must still be in flight: `1.3` s of game time. */
const BEFORE_TICKS = ticksFor(SAUCER_BULLET_LIFE - BRACKET);

/** The moment it must be gone by: `1.5` s. */
const AFTER_TICKS = ticksFor(SAUCER_BULLET_LIFE + BRACKET);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a saucer round off the field between 1.3 s and 1.5 s", async () => {
  startPlaying(h);
  const round = poseEnemyBullet(h, START.x, START.y, SAUCER_BULLET_SPEED, 0);
  const inFlight = (): number[] =>
    h.snapshot().enemyBullets.map((shot) => shot.id);

  await h.advance(BEFORE_TICKS);
  assertDeepEqual(
    inFlight(),
    [round],
    `the saucer rounds in flight ${SAUCER_BULLET_LIFE - BRACKET} s into a ` +
      `${SAUCER_BULLET_LIFE} s life (specs/saucer.md)`,
  );

  await h.advance(AFTER_TICKS - BEFORE_TICKS);
  captureStill(h, "expiry");

  assertDeepEqual(
    inFlight(),
    [],
    `the saucer rounds in flight ${SAUCER_BULLET_LIFE + BRACKET} s into a ` +
      `${SAUCER_BULLET_LIFE} s life (specs/saucer.md)`,
  );
});
