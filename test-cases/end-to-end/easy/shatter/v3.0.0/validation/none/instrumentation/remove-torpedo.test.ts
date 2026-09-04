// instrumentation/remove-torpedo — `removeTorpedo(id)` removes exactly the torpedo
// that id names, and leaves the others in flight carrying their own ids. `warhead`
// only.
//
// THREE TORPEDOES, AND THE ONE ADDRESSED IS THE MIDDLE OF THEM. `specs/instrumentation.md`
// gives every torpedo an id on the same terms as every other entity — distinct
// among the entities live at any moment, appended last to its roster — and has the
// per-entity operation take one, so the fault this is hunting is an operation that
// removes by POSITION rather than by identity. Naming the middle entry tells a
// build that removed the first, and one that removed the last, apart from the right
// answer.
//
// AND THE SURVIVORS ARE READ BY ID RATHER THAN COUNTED. A roster of the right
// length can still be the wrong two torpedoes.
//
// NOTHING ELSE IS ON THE FIELD, and the guidance of all three is off: with no rock
// and no saucer up there is nothing to acquire in any case, and a torpedo that
// steered would be reading `setTorpedoHoming` rather than this. `specs/weapons.md`
// gives a torpedo `TORPEDO_LIFE` (3.5 seconds), so nothing but the operation can
// take one off the roster over the two ticks this spends.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  HANDLE,
  poseTorpedo,
  startPlaying,
  torpedoById,
  type Harness,
} from "../harness";

/** The operations this check drives, all of them stated under `warhead`. */
const OPS = ["addTorpedo", "setTorpedoHoming", "removeTorpedo"] as const;

/** Where the three torpedoes are put: spread, and well clear of the star's core. */
const PLACES = [
  { x: 400, y: 300 },
  { x: 500, y: 640 },
  { x: 900, y: 300 },
] as const;

/** The heading each is launched on: straight across the field, in radians. */
const HEADING = 0;

/** Which of the three is addressed: the middle one, so neither end is the answer. */
const ADDRESSED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the torpedo its id names and no other", async () => {
  const probed = await h.probe(OPS);
  for (const op of OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }

  await startPlaying(h);
  const ids: number[] = [];
  for (const place of PLACES) {
    ids.push(
      await poseTorpedo(h, place.x, place.y, HEADING, { homing: false }),
    );
  }
  await h.advance(1);
  assertLength(
    (await h.snapshot()).torpedoes ?? [],
    PLACES.length,
    "the torpedoes the field held",
  );

  await h.debug.removeTorpedo(ids[ADDRESSED]);
  await h.advance(1);
  await captureStill(h, "removed");
  const after = await h.snapshot();

  assertLength(
    after.torpedoes ?? [],
    PLACES.length - 1,
    "the torpedoes that outlived it",
  );
  assertEqual(
    torpedoById(after, ids[ADDRESSED]),
    undefined,
    `the torpedo ${ids[ADDRESSED]} removeTorpedo was handed`,
  );
  const flying = (after.torpedoes ?? []).map((torpedo) => torpedo.id);
  for (const [index, id] of ids.entries()) {
    if (index === ADDRESSED) continue;
    assertContains(flying, id, `the torpedo ${id} still carrying its id`);
  }
});
