// instrumentation/clear-torpedoes — `clearTorpedoes()` empties the torpedo roster
// and leaves every other roster standing. `warhead` only.
//
// WHY THIS OPERATION NEEDS AN ITEM. It sits inside the harness's own `clearWorld`,
// which every posed scenario in a `warhead` run passes through — so a build that
// implements it wrongly contaminates scenarios across the torpedo, detonation and
// armor groups with nothing naming the cause. This is the item that names it.
//
// THE SECOND HALF IS THE HALF THAT MATTERS. `specs/instrumentation.md` gives the
// operation both halves — "Removes every torpedo, leaving the rest standing" — and
// the field this runs over therefore carries something on every roster at once,
// each survivor read back BY ITS ID rather than counted: a roster of the right
// length can still be the wrong entities.
//
// THE TORPEDOES ARE POSED WITH THEIR GUIDANCE OFF. The requirement is the clear,
// and a torpedo that acquired one of the rocks on the field would be turning onto
// it while the check was arranging the scenario; `setTorpedoHoming` has its own
// item, and this one exercises only what it needs.
//
// AND THE SURFACE IS REFLECTED BEFORE IT IS DRIVEN. The torpedo operations are a
// `warhead` deliverable, so a build that carries none of them fails here with what
// the specification requires named, rather than crashing the script on a call into
// something that is not a function.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  HANDLE,
  poseTorpedo,
  requireSaucer,
  startPlaying,
  type Harness,
} from "../harness";
import { posePopulatedField } from "./populated-field";

/** The operations this check drives, all of them stated under `warhead`. */
const OPS = ["addTorpedo", "setTorpedoHoming", "clearTorpedoes"] as const;

/**
 * Where the three torpedoes are put, and the heading each is given.
 *
 * Spread across empty ground: each is more than a hundred units from the star's
 * core, from every body the populated field holds, and from the ship, so over the
 * single tick that renders the field none of them can reach anything.
 */
const PLACES = [
  { x: 400, y: 300 },
  { x: 500, y: 640 },
  { x: 900, y: 300 },
] as const;

/** The heading each torpedo is launched on: straight across the field, in radians. */
const HEADING = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every torpedo and leaves the rest of the field standing", async () => {
  const probed = await h.probe(OPS);
  for (const op of OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }

  await startPlaying(h);
  const posed = await posePopulatedField(h);
  const torpedoes: number[] = [];
  for (const place of PLACES) {
    torpedoes.push(
      await poseTorpedo(h, place.x, place.y, HEADING, { homing: false }),
    );
  }
  await h.advance(1);
  assertLength(
    (await h.snapshot()).torpedoes ?? [],
    PLACES.length,
    "the torpedoes the field held",
  );

  await h.debug.clearTorpedoes();
  await h.advance(1);
  await captureStill(h, "cleared");
  const after = await h.snapshot();

  assertLength(after.torpedoes ?? [], 0, "the torpedoes clearTorpedoes left");
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
    requireSaucer(after, "the saucer clearTorpedoes left standing").id,
    posed.saucer,
    "the saucer left standing",
  );
  // The torpedoes were removed rather than spent: nothing they could have struck
  // was on their path, and nothing paid.
  assertEqual(
    after.score,
    0,
    "clearTorpedoes destroys nothing, so it scores nothing",
  );
});
