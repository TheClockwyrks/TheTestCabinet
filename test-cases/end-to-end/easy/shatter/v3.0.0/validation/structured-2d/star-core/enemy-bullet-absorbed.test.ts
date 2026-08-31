// star-core/enemy-bullet-absorbed — the core swallows the saucer's rounds too.
//
// THE RULE. `specs/collision.md`'s pair table: "A saucer bullet and the core |
// THE BULLET IS ABSORBED AND REMOVED." The core is a boundary on the field
// rather than a rule about the player's gun, so it answers the saucer's rounds
// the same way it answers the ship's.
//
// WHY IT IS A POINT OF ITS OWN. A build that resolves the core against its own
// bullet roster and forgets the saucer's is wrong in exactly one place, and
// wrong in a way a player sees: the saucer's shots pile through the star instead
// of being eaten by it. `star-core/bullet-absorbed` cannot notice, because it
// never puts a saucer round on the field — so the two rosters are two points.
//
// WHAT IS READ. The saucer-bullet roster, on the first tick within the drive at
// which it is empty, or at the end of the drive if it never is. The scenario
// poses one enemy round and nothing else, so an empty roster is that round
// having been taken.
//
// WHY THE ROUND IS AIMED DEAD AT THE CENTRE. It is placed `RANGE` (`150`) units
// out and sent straight at `(STAR_X, STAR_Y)`. `specs/gravity.md` pulls a saucer
// bullet along the direct vector to that same point, so the well lies along the
// flight: it brings the round in sooner and bends it nowhere. The contact is the
// one this check arranged, not one the well steered into.
//
// WHY THE DRIVE IS SHORT. `SAUCER_BULLET_LIFE` is `1.4` seconds
// (`specs/saucer.md`) and the drive is `0.6` of one, so a roster that is empty
// at the end of it was emptied by the core rather than by the clock. And nothing
// else on the field could have taken the round: `startPlaying` leaves no rock,
// no saucer, and the ship's lethal contact test off — which is right, because
// `specs/collision.md` has a saucer bullet reaching the SHIP removed as well,
// and this point is about the core. The round's course passes a hundred and
// sixty units clear of the ship's centre in any case.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that absorbs only the
// ship's rounds leaves this one in flight and reads a roster of `1`: the drive
// is far too short for it to expire, and travelling at `SAUCER_BULLET_SPEED`
// from `150` units out it is still on the field at the end of it. A build that
// lets the saucer's rounds pass through the star reads `1` for the same reason.
// A build that removes an enemy round for some reason of its own before it ever
// reaches the core would pass here — and is decided where that reason belongs:
// `saucer/bullet-life` for the clock, `gravity/enemy-bullet-curves` for a round
// that has to survive a flight past the star to be read at all.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_BULLET_LIFE, SAUCER_BULLET_SPEED } from "../../src/constants";
import { assertLength } from "../assert";
import { DEG } from "../geometry";
import {
  captureStill,
  createHarness,
  poseEnemyBullet,
  requireEnemyBullet,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { aroundTheStar, inwardFrom } from "./approach";

/** How far from the star's centre the round is placed, in units. */
const RANGE = 150;

/** The bearing it comes in on: off every axis and every diagonal, and not the
 * one `star-core/bullet-absorbed` uses, so the two points are two flights. */
const BEARING = 35 * DEG;

/**
 * How long the round is followed, in ticks: `0.6` seconds of game time.
 *
 * The round covers the `117` units between it and the core in about `0.39`
 * seconds at `SAUCER_BULLET_SPEED` (`300`) before the well is counted, and
 * sooner with it, so the contact is comfortably inside the drive. And `0.6`
 * seconds is well under `SAUCER_BULLET_LIFE` (`1.4`), so nothing here can be
 * confused with the round expiring.
 */
const DRIVE_TICKS = ticksFor(0.6);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a saucer round that reaches the core", async () => {
  startPlaying(h);

  const from = aroundTheStar(RANGE, BEARING);
  const at = inwardFrom(from, SAUCER_BULLET_SPEED);
  const id = poseEnemyBullet(h, from.x, from.y, at.vx, at.vy);
  requireEnemyBullet(
    h.snapshot(),
    id,
    `addEnemyBullet(${from.x.toFixed(2)}, ${from.y.toFixed(2)}, ` +
      `${at.vx.toFixed(2)}, ${at.vy.toFixed(2)}) to put a saucer round in ` +
      "flight (specs/instrumentation.md)",
  );

  const drive = await h.until(
    (snapshot) => snapshot.enemyBullets.length === 0,
    {
      maxFrames: DRIVE_TICKS,
      poll: 1,
    },
  );

  // The core with the enemy round gone into it.
  captureStill(h, "absorbed");

  assertLength(
    drive.snapshot.enemyBullets,
    0,
    "the saucer-bullet roster to be empty after a round sent straight at the " +
      `star's centre from ${RANGE} units out reached the core: the core ` +
      "absorbs a saucer bullet that reaches it and removes it " +
      `(specs/collision.md), inside the ${(DRIVE_TICKS / 120).toFixed(1)} ` +
      `seconds driven here — well under the ${SAUCER_BULLET_LIFE} second ` +
      "SAUCER_BULLET_LIFE, so an expiry is not what empties it",
  );
});
