// instrumentation/remove-bullet — `removeBullet(id)` takes the bullet carrying
// that id out of flight, of either kind, and leaves every other bullet exactly as
// it was.
//
// specs/instrumentation.md gives the operation one line — "Removes the bullet with
// that id" — over the one roster that holds both kinds: "One roster holds both
// kinds, told apart by `friendly`. Ids are unique across the whole roster." That
// shared roster is why this point removes one of each: a build that indexed its
// two kinds separately, or that told them apart by their position in the roster,
// takes the wrong bullet on one of the two and the right one on the other.
//
// SO THE REMOVAL IS RUN TWICE ON THE SAME FIELD. One of the player's bullets
// first, with the other three held to being untouched, and then one of the
// enemy's, with the remaining two held the same way. Each reading is of one
// removal, so a failure names which kind the build got wrong.
//
// AND THE SURVIVORS ARE COMPARED ENTRY BY ENTRY, not counted. The specification
// leaves an entity's id untouched for its whole life (Identity), so a build that
// re-numbered the roster after the splice — which is what a build storing "the id"
// as a roster POSITION does — is caught here.
//
// NOTHING RUNS BETWEEN THE POSES AND THE READINGS. The harness owns the clock, so
// every reading is of the same instant as the one before it and a bullet that is
// gone is gone because the removal took it, rather than because it flew off the
// field (specs/field.md).
//
// WHAT THIS DOES NOT DECIDE. Removing a whole kind at once, which is
// `instrumentation/clear-player-bullets` and `instrumentation/clear-enemy-bullets`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThan,
  assertNull,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  findBullet,
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

it("removes one bullet of either kind and leaves the others in flight", async () => {
  const posed = await poseCrowdedField(h);
  const friendly = posed.friendly[0];
  const enemy = posed.enemy[0];
  if (friendly === undefined || enemy === undefined) {
    fail(
      "a field placing at least one bullet of each kind for this scenario",
      `${String(posed.friendly.length)} of the player's and ` +
        `${String(posed.enemy.length)} enemy`,
    );
  }

  /** Remove one bullet and hold every other entry of the roster to standing. */
  const removes = (id: number, what: string): void => {
    const before = h.snapshot();
    assertGreaterThan(
      before.bullets.length,
      1,
      `the bullets in flight before ${what} was removed — with only one on ` +
        "the roster there is nothing to hold to standing",
    );

    h.debug.removeBullet(id);
    const after = h.snapshot();

    assertNull(
      findBullet(after, id),
      `the bullet carrying id ${String(id)} after removeBullet(` +
        `${String(id)}), which is ${what}`,
    );
    assertDeepEqual(
      sortedById(after.bullets),
      sortedById(before.bullets.filter((bullet) => bullet.id !== id)),
      "every other bullet in flight, against the same entries read at the " +
        `instant before removeBullet(${String(id)}) was called — an entity ` +
        "keeps its id for its whole life (specs/instrumentation.md, Identity)",
    );
  };

  removes(friendly, "one of the player's");
  removes(enemy, "one of the enemy's");

  await h.advance(1);
  // After the readings, purely so the review has the picture of the field the two
  // removals left.
  captureStill(h, "removed");
});
