// saucer/destroyed-by-a-bullet — one of the ship's rounds takes the saucer down.
//
// THE RULE. `specs/collision.md`, What each pair does: "A bullet and the saucer |
// Both are removed, and the saucer scores." `specs/saucer.md` states the same from
// the saucer's side. This point decides the REMOVAL of both, in one direction: the
// score the kill pays is `scoring/saucer-scores-200`'s.
//
// WHAT IS READ. That the slot reports clear and that the round is off its roster,
// after a round placed on the craft's doorstep is let go. Both, because a build
// that removes the saucer and leaves the round in flight has the round on to hit
// the next thing behind it, and a build that removes the round and leaves the
// craft up has a saucer that cannot be shot down at all.
//
// THE ROUND IS PLACED ON THE DOORSTEP, ON THE SIDE FACING AWAY FROM THE STAR.
// `aimedRound` puts it `ROUND_STANDOFF` outside the craft's circle on the far side
// from `(STAR_X, STAR_Y)` and fires it inward, so it is travelling away from the
// core for its whole flight: a round placed on the near side would have the core
// behind the craft on any miss, and `specs/collision.md` has the core absorb a
// round that reaches it — so a build that missed would look like a build that had
// killed. The standoff is a couple of ticks at `MUZZLE_SPEED`, which is short
// enough that the well cannot bend the shot.
//
// THE CRAFT IS HELD STILL AND EMPTIED OF EVERYTHING ELSE. `setSaucerTravel(false)`
// holds its centre, so the round meets it where it was placed rather than where it
// has got to; `setSaucerVelocity(0, 0)` takes the arrival cruise off the craft it
// was placed against, so the round needs no lead; the mind and the gun are shut,
// because neither has anything to do with being shot. `startPlaying` leaves no
// rock on the field, so nothing else can take the round first
// (`specs/collision.md` resolves whichever a round reaches first in the tick).

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_R } from "../constants";
import { assertNull, assertTrue, assertUndefined } from "../assert";
import {
  aimedRound,
  bulletById,
  captureStill,
  createHarness,
  poseBullet,
  poseSaucer,
  startPlaying,
  type Harness,
} from "../harness";

/** Where the craft is held: clear of the star, and clear of the ship. */
const SAUCER_X = 400;
const SAUCER_Y = 140;

/** How long the round is followed for, in ticks: a doorstep is a tick or two. */
const SETTLE_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes both the saucer and the round that reached it", async () => {
  startPlaying(h);
  poseSaucer(h, SAUCER_X, SAUCER_Y);
  h.debug.setSaucerVelocity(0, 0);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);

  const round = aimedRound({
    x: SAUCER_X,
    y: SAUCER_Y,
    vx: 0,
    vy: 0,
    radius: SAUCER_R,
  });
  const bulletId = poseBullet(h, round.x, round.y, round.vx, round.vy);

  const kill = await h.until((snapshot) => snapshot.saucer === null, {
    maxFrames: SETTLE_TICKS,
  });
  // The field the instant the saucer was shot down.
  captureStill(h, "kill");

  assertTrue(
    kill.hit,
    `the saucer removed within ${SETTLE_TICKS} ticks of a round being let go ` +
      `on its doorstep — a bullet and the saucer both are removed ` +
      "(specs/collision.md)",
  );
  assertNull(
    kill.snapshot.saucer,
    "the saucer slot after the round reached it (specs/collision.md)",
  );
  assertUndefined(
    bulletById(kill.snapshot, bulletId),
    `round ${bulletId} on the ship's roster after it reached the saucer — ` +
      "both are removed, so the round is spent on the kill " +
      "(specs/collision.md)",
  );
});
