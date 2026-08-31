// star-core/bullet-absorbed — the core swallows one of the ship's rounds, and
// pays nothing for it.
//
// THE RULE. `specs/collision.md`'s pair table: "A bullet and the core | THE
// BULLET IS ABSORBED AND REMOVED. NOTHING SCORES." `specs/field.md` says the
// same from the star's side: the core is "the one physical boundary on the
// field: a shot that reaches it is absorbed". This item is that one row, in both
// of its halves — the round goes, and the score does not move — because they are
// the two ways a build can get this pair wrong and the review item names both.
//
// WHAT IS READ. The bullet roster and the score, on the first tick within the
// drive at which the roster is empty, or at the end of the drive if it never is.
// The scenario poses one round and nothing else, so an empty roster is that
// round having been taken.
//
// WHY THE ROUND IS AIMED DEAD AT THE CENTRE. It is fired from `RANGE` (`150`)
// units out, straight at `(STAR_X, STAR_Y)`. `specs/gravity.md` pulls one of the
// ship's bullets along the direct vector to that same point, so the well lies
// exactly along the flight: it makes the round arrive sooner and moves it off
// the line by nothing at all. The contact is therefore the one this check
// arranged rather than one gravity steered into, and a build whose pull is a
// little strong or a little weak is not failed here for it.
//
// WHY THE DRIVE IS SHORT, AND WHY THAT IS THE POINT. `BULLET_LIFE` is `1.5`
// seconds (`specs/weapons.md`) and the drive is `0.4` of one: less than a third
// of the round's life, so a roster that is empty at the end of it was emptied by
// the core and not by the clock. Nothing else on the field could have taken the
// round either — `startPlaying` leaves no rock, no saucer and no other body
// standing.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build with no absorption at
// all still has the round in flight at the end of the drive — it is `150` units
// from the star travelling at `MUZZLE_SPEED` and the drive is far too short for
// it to leave the field or expire — so the roster reads `1`. A build that scores
// the core as though it were a rock reads a score of `20`, `50` or `100` instead
// of `0`. A build that absorbs the round and lets it pass on to whatever is
// behind the star reads the roster empty and would pass, which is right: there
// is nothing behind the star for it to reach, and what a round does to a rock is
// the `detonation` group's.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_LIFE, MUZZLE_SPEED } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  requireBullet,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { DEG } from "../geometry";
import { aroundTheStar, inwardFrom } from "./approach";

/** How far from the star's centre the round is fired from, in units. */
const RANGE = 150;

/** The bearing it is fired from: off every axis and every diagonal. */
const BEARING = 205 * DEG;

/**
 * How long the round is followed, in ticks: `0.4` seconds of game time.
 *
 * The round covers the `117` units between it and the core in about `0.22`
 * seconds at `MUZZLE_SPEED` (`520`) before the well is counted, and sooner with
 * it, so the contact is comfortably inside the drive. And `0.4` seconds is less
 * than a third of `BULLET_LIFE` (`1.5`), so nothing here can be confused with
 * the round expiring.
 */
const DRIVE_TICKS = ticksFor(0.4);

/** The score a run that has shot nothing stands at (`specs/scoring.md`). */
const NO_SCORE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes one of the ship's rounds that reaches the core, and scores nothing", async () => {
  startPlaying(h);

  const from = aroundTheStar(RANGE, BEARING);
  const at = inwardFrom(from, MUZZLE_SPEED);
  const id = poseBullet(h, from.x, from.y, at.vx, at.vy);
  requireBullet(
    h.snapshot(),
    id,
    `addBullet(${from.x.toFixed(2)}, ${from.y.toFixed(2)}, ` +
      `${at.vx.toFixed(2)}, ${at.vy.toFixed(2)}) to put a round in flight ` +
      "(specs/instrumentation.md)",
  );

  const drive = await h.until((snapshot) => snapshot.bullets.length === 0, {
    maxFrames: DRIVE_TICKS,
    poll: 1,
  });

  // The core with the shot gone into it.
  captureStill(h, "absorbed");

  assertLength(
    drive.snapshot.bullets,
    0,
    "the ship's bullet roster to be empty after a round fired straight at " +
      `the star's centre from ${RANGE} units out reached the core: the core ` +
      "absorbs a shot that reaches it and removes it (specs/collision.md, " +
      `specs/field.md), inside the ${(DRIVE_TICKS / 120).toFixed(1)} seconds ` +
      `driven here — a third of the ${BULLET_LIFE} second BULLET_LIFE, so an ` +
      "expiry is not what empties it",
  );

  assertEqual(
    drive.snapshot.score,
    NO_SCORE,
    "the score to be unmoved by the core absorbing a round: nothing scores " +
      "for a bullet and the core (specs/collision.md)",
  );
});
