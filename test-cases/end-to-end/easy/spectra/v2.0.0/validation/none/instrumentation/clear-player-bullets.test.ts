// Spectra — instrumentation/clear-player-bullets: `clearPlayerBullets()` removes
// the player's bullets and leaves the enemy bullets, the drones and the bursts
// standing.
//
// `specs/instrumentation.md` gives the operation exactly that scope — it "Removes
// every one of the player's bullets, leaving the enemy bullets, the drones, and
// the bursts standing" — over the one roster that holds both kinds, "told apart by
// `friendly`". That is what makes the operation worth a point of its own: it is a
// removal by a PREDICATE over a shared roster, and the two ways to get it wrong —
// taking the whole roster, or taking the wrong half — are exactly what the readings
// below tell apart.
//
// Every other point in this suite starts from `startPosed`, which calls this clear
// among the four; one that took the enemy bullets with it would quietly empty a
// scenario that had asked for them, and the point that failed would be the one
// about the mechanic rather than the one about the clear.
//
// SO THE FIELD CARRIES ALL FOUR ROSTERS AT ONCE (`./crowded-field.ts`), with two
// bullets of each kind: the friendly pair must go, and the enemy pair, the drones
// and the burst must be exactly as they were. The three surviving rosters are
// compared entry by entry rather than counted, so a clear that dropped one enemy
// bullet of two is caught as surely as one that emptied the roster.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING. The harness holds the game off
// the wall clock (`specs/instrumentation.md`, The clock), so both readings are of
// the same instant and the survivors are held to being UNTOUCHED rather than to
// being merely still there.
//
// WHAT THIS DOES NOT DECIDE. The other half of the same roster, which is
// `instrumentation/clear-enemy-bullets` — a build that emptied the whole roster
// fails both, and one that took the wrong half fails both, so the pair tells the
// two apart rather than averaging them out.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBullets,
  playerBullets,
  type Harness,
} from "../harness";
import { poseCrowdedField, sortedById } from "./crowded-field";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes the player's bullets and leaves the enemy bullets, drones and bursts", async () => {
  await poseCrowdedField(h);

  const before = await h.snapshot();
  assertGreaterThan(
    playerBullets(before).length,
    0,
    "the player's bullets this scenario placed, which the clear must take",
  );
  assertGreaterThan(
    enemyBullets(before).length,
    0,
    "the enemy bullets this scenario placed, which the clear must leave",
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

  await h.debug.clearPlayerBullets();
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // field it produced.
  await captureStill(h, "cleared");

  assertLength(
    playerBullets(after),
    0,
    "the player's bullets in flight after clearPlayerBullets()",
  );

  assertDeepEqual(
    sortedById(enemyBullets(after)),
    sortedById(enemyBullets(before)),
    "the enemy bullets in flight, against the same entries read at the " +
      "instant before clearPlayerBullets() was called",
  );
  assertDeepEqual(
    sortedById(after.drones),
    sortedById(before.drones),
    "the drones on the field, against the same roster read at the instant " +
      "before clearPlayerBullets() was called",
  );
  assertDeepEqual(
    sortedById(after.bursts),
    sortedById(before.bursts),
    "the bursts playing, against the same roster read at the instant before " +
      "clearPlayerBullets() was called",
  );
});
