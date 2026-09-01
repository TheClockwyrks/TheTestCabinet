// instrumentation/clear-enemy-bullets — `clearEnemyBullets()` removes the enemy
// bullets and leaves the player's bullets, the drones and the bursts standing.
//
// specs/instrumentation.md gives the operation exactly that scope: it "Removes
// every enemy bullet, leaving the player's bullets, the drones, and the bursts
// standing" — over the one roster that holds both kinds, "told apart by
// `friendly`". It is a removal by a PREDICATE over a shared roster, and the two
// ways to get it wrong — taking the whole roster, or taking the wrong half — are
// exactly what the readings below tell apart.
//
// `startPosed` calls this clear among the four, so one that took the player's
// bullets with it would quietly empty a scenario that had asked for them, and the
// point that failed would be the one about the mechanic rather than the one about
// the clear.
//
// SO THE FIELD CARRIES ALL FOUR ROSTERS AT ONCE (`./crowded.ts`), with two bullets
// of each kind: the enemy pair must go, and the friendly pair, the drones and the
// burst must be exactly as they were. The three surviving rosters are compared
// ENTRY BY ENTRY rather than counted, so a clear that dropped one of the player's
// bullets of two is caught as surely as one that emptied the roster.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING. The harness owns the clock, so
// both readings are of the same instant and the survivors are held to being
// UNTOUCHED rather than to being merely still there.
//
// WHAT THIS DOES NOT DECIDE. The other half of the same roster, which is
// `instrumentation/clear-player-bullets`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBullets,
  playerBullets,
  type Harness,
} from "../harness";
import { poseCrowdedField, sortedById } from "./crowded";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the enemy bullets and leaves the player's bullets, drones and bursts", async () => {
  await poseCrowdedField(h);

  const before = h.snapshot();
  assertGreaterThan(
    enemyBullets(before).length,
    0,
    "the enemy bullets this scenario placed, which the clear must take",
  );
  assertGreaterThan(
    playerBullets(before).length,
    0,
    "the player's bullets this scenario placed, which the clear must leave",
  );
  assertGreaterThan(
    before.drones.length,
    0,
    "the drones this scenario posed, which the clear must leave",
  );
  assertGreaterThan(
    before.bursts.length,
    0,
    "the bursts the kill in this scenario left playing, which the clear must " +
      "leave",
  );

  h.debug.clearEnemyBullets();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // field it produced.
  captureStill(h, "cleared");

  assertLength(
    enemyBullets(after),
    0,
    "the enemy bullets in flight after clearEnemyBullets()",
  );
  assertDeepEqual(
    sortedById(playerBullets(after)),
    sortedById(playerBullets(before)),
    "the player's bullets in flight, against the same entries read at the " +
      "instant before clearEnemyBullets() was called — one roster holds both " +
      "kinds, told apart by friendly (specs/instrumentation.md)",
  );
  assertDeepEqual(
    sortedById(after.drones),
    sortedById(before.drones),
    "the drones on the field, against the same roster read at the instant " +
      "before clearEnemyBullets() was called",
  );
  assertDeepEqual(
    sortedById(after.bursts),
    sortedById(before.bursts),
    "the bursts playing, against the same roster read at the instant before " +
      "clearEnemyBullets() was called",
  );
});
