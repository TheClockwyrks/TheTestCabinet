// star-core/bullet-absorbed — the core absorbs one of the ship's rounds.
//
// `specs/collision.md` pairs a bullet with the core in one line: "The bullet is
// absorbed and removed. Nothing scores." `specs/field.md` says the same thing from
// the star's side — the core is the one physical boundary on the field, and a shot
// that reaches it is absorbed. This item is that pair and nothing else; the enemy
// round's half of it is `star-core/enemy-bullet-absorbed`, which fails separately,
// so a build that absorbs one kind of round and not the other fails exactly one of
// the two.
//
// THE SCENARIO. One round is placed a hundred units from the star's centre on the
// star's own row, travelling straight at it at the gun's `MUZZLE_SPEED`, on an
// empty and quiet field. Sixty-seven of those units are the gap between the
// round's leading edge and the core's surface, which it covers in an eighth of a
// second; a third of a second is then run, and the roster is read.
//
// WHY A THIRD OF A SECOND AND NOT LONGER. `specs/weapons.md` gives a round a
// `BULLET_LIFE` of `1.5` seconds, so a build that absorbs nothing STILL HAS ITS
// ROUND IN FLIGHT when the reading is taken, with more than a second of life left
// — the round is gone because the core took it, and not because it timed out.
// There is no third answer for the tolerance to sit between: the roster holds one
// round or none.
//
// WHY IT COMES IN FROM THE LEFT. The ship stands at its safe point below the star
// (`specs/ship.md`), so a round crossing the star's row travels away from it
// rather than at it; nothing but the core is on the line. The field is empty
// besides — `startPlaying` clears every roster and holds the wave loop and the
// saucer's arrival off — so the only body the round can reach is the one this item
// is about.
//
// AND THE SCORE. `specs/collision.md` says nothing scores, and `specs/scoring.md`
// pays only for a destroyed rock and a destroyed saucer, so the absorption must
// leave the score exactly where `startPlaying` set it. Read here rather than in
// its own item because the review item states both halves.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R, CORE_R, MUZZLE_SPEED, STAR_X, STAR_Y } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import type { Point } from "../geometry";

/** How far from the star's centre the round is placed, in units. */
const RANGE = 100;

/** Where that puts it: on the star's row, to its left. */
const START: Point = { x: STAR_X - RANGE, y: STAR_Y };

/** The gap the round must close before its circle reaches the core's surface. */
const REACH = RANGE - (CORE_R + BULLET_R);

/**
 * How long the round is followed: a third of a second.
 *
 * More than twice the eighth of a second the round needs to cross {@link REACH} at
 * `MUZZLE_SPEED` — and the well only quickens it, since `specs/gravity.md` pulls a
 * bullet and the pull here runs along the travel — and far short of the `1.5`
 * seconds `specs/weapons.md` gives it to live, so a round still on the field at the
 * reading is a round the core did not take.
 */
const FLIGHT_TICKS = ticksFor(1 / 3);

/** What the score must still read: the score is `startPlaying`'s, untouched. */
const NOTHING_SCORED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a round driven into the core off the field, and pays nothing for it", async () => {
  startPlaying(h);
  poseBullet(h, START.x, START.y, MUZZLE_SPEED, 0);

  await h.advance(FLIGHT_TICKS);
  captureStill(h, "absorbed");

  const snapshot = h.snapshot();
  assertLength(
    snapshot.bullets,
    0,
    `the ship's bullets in flight ${secondsFor(FLIGHT_TICKS).toFixed(2)} ` +
      `seconds after one was placed ${REACH} units short of the core's ` +
      "surface and sent at it (specs/collision.md: a bullet and the core, " +
      "the bullet is absorbed and removed)",
  );
  assertEqual(
    snapshot.score,
    NOTHING_SCORED,
    "the score after the core absorbed a round (specs/collision.md: nothing " +
      "scores)",
  );
});
