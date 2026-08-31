// instrumentation/clear-torpedoes — `clearTorpedoes()` empties the torpedo roster
// and leaves every other roster standing. `warhead` only.
//
// THE SECOND HALF IS THE HALF THAT MATTERS, and here it matters more than for any
// of the other clears. `specs/instrumentation.md` gives the operation both halves —
// "Removes every torpedo, leaving the rest standing" — and this is the one the
// harness's own `clearWorld` calls LAST, after the three common rosters and the
// saucer. So a build whose `clearTorpedoes` takes a neighbour with it does not fail
// here alone: it empties something every `warhead` scenario in `torpedo`,
// `detonation` and `armor` had just posed, and those checks fail for reasons none
// of them names. That is why this item exists on the `warhead` checklist at all.
//
// SO THE FIELD CARRIES SOMETHING ON EVERY ROSTER AT ONCE, and each survivor is read
// back BY ITS ID: a build that emptied a roster and refilled it would be caught by
// the count, and one that replaced an entity with a fresh one is caught by the id.
//
// THE TORPEDOES ARE POSED WHERE THEY ACQUIRE NOTHING. `specs/weapons.md` gives a
// torpedo a forward cone of `TORPEDO_CONE` (15 degrees) and has it take the nearest
// candidate inside it every tick, so a torpedo posed with a rock ahead of it would
// be turning while the roster it is on is counted. Both are posed below the star,
// heading down and away from every body on the field, so the only thing that
// happens to the torpedo roster between the pose and the clear is the clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, fail } from "../assert";
import {
  captureStill,
  createHarness,
  poseTorpedo,
  startPlaying,
  theSaucer,
  torpedoesOf,
  type Harness,
} from "../harness";
import { posePopulatedField } from "./populated-field";

/**
 * Where the two torpedoes are posed, and the heading they carry.
 *
 * Below the star and heading straight down (`specs/overview.md` measures angles
 * clockwise from `+x`, so a quarter turn is down the field), which is away from
 * every rock and from the saucer the populated field puts up — all of which stand
 * above them. Nothing is in either cone, so neither torpedo acquires anything.
 */
const TORPEDO_PLACES = [
  { x: 500, y: 480 },
  { x: 780, y: 480 },
] as const;
const TORPEDO_HEADING = Math.PI / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every torpedo and leaves the rest of the field standing", async () => {
  startPlaying(h);
  const posed = posePopulatedField(h);
  const torpedoes = TORPEDO_PLACES.map((place) =>
    poseTorpedo(h, place.x, place.y, TORPEDO_HEADING),
  );
  await h.advance(1);
  assertLength(
    torpedoesOf(h.snapshot()),
    torpedoes.length,
    "the torpedoes the field held",
  );

  if (h.debug.clearTorpedoes === undefined) {
    fail(
      "a clearTorpedoes operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.clearTorpedoes();
  await h.advance(1);
  captureStill(h, "cleared");
  const after = h.snapshot();

  assertLength(torpedoesOf(after), 0, "the torpedoes clearTorpedoes left");
  assertDeepEqual(
    after.rocks.map((rock) => rock.id),
    posed.rocks,
    "the rocks left standing",
  );
  assertDeepEqual(
    after.bullets.map((bullet) => bullet.id),
    posed.bullets,
    "the ship's bullets left standing",
  );
  assertDeepEqual(
    after.enemyBullets.map((bullet) => bullet.id),
    posed.enemyBullets,
    "the saucer bullets left standing",
  );
  assertEqual(
    theSaucer(after, "the saucer clearTorpedoes left standing").id,
    posed.saucer,
    "the saucer left standing",
  );
});
