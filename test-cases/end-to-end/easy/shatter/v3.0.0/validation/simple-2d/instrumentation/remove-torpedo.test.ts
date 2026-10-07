// instrumentation/remove-torpedo — `removeTorpedo(id)` removes exactly the torpedo
// that id names, and leaves the others in flight carrying their own ids. `warhead`
// only.
//
// THREE TORPEDOES, AND THE ONE ADDRESSED IS THE MIDDLE OF THEM.
// `specs/instrumentation.md` makes every torpedo's id "distinct among the entities
// live at any moment" and has every per-entity operation take one, so the fault
// this is hunting is an operation that removes by POSITION rather than by identity
// — the first of the roster, the last of it, or the one whose index happened to
// match the number it was handed. Naming the middle entry tells all three apart
// from the right answer: a build that removed the first leaves a roster missing the
// wrong id, and so does a build that removed the last.
//
// AND THE SURVIVORS ARE READ BY ID RATHER THAN COUNTED. A roster of the right
// length can still be the wrong two torpedoes, and a build that removed one and
// re-created another would pass a count.
//
// NOTHING ELSE IS ON THE FIELD, which for a torpedo is a requirement rather than a
// tidiness: `specs/weapons.md` has one acquire the nearest rock or saucer inside
// its forward cone every tick, so a field with a rock on it is a field where a
// torpedo turns, and a turning torpedo eventually lands and leaves its roster
// without anything having removed it. With no rock and no saucer up there is no
// candidate, so the roster changes only when this operation changes it. The three
// fly along rows well clear of the star, so none is absorbed by the core either.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength, assertUndefined, fail } from "../assert";
import {
  captureStill,
  createHarness,
  poseTorpedo,
  startPlaying,
  torpedoesOf,
  type Harness,
} from "../harness";

/** Where the three torpedoes fly: spread, all heading right, clear of the star. */
const PLACES = [
  { x: 160, y: 120 },
  { x: 160, y: 620 },
  { x: 900, y: 120 },
] as const;
const HEADING = 0;

/** Which of the three is addressed: the middle one, so neither end is the answer. */
const ADDRESSED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the torpedo its id names and no other", async () => {
  startPlaying(h);
  const ids = PLACES.map((place) => poseTorpedo(h, place.x, place.y, HEADING));
  await h.advance(1);
  assertLength(
    torpedoesOf(h.snapshot()),
    PLACES.length,
    "the torpedoes the field held",
  );

  if (h.debug.removeTorpedo === undefined) {
    fail(
      "a removeTorpedo operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.removeTorpedo(ids[ADDRESSED]);
  await h.advance(1);
  captureStill(h, "removed");
  const after = torpedoesOf(h.snapshot());

  assertLength(after, PLACES.length - 1, "the torpedoes that outlived it");
  assertUndefined(
    after.find((torpedo) => torpedo.id === ids[ADDRESSED]),
    `the torpedo ${ids[ADDRESSED]} removeTorpedo was handed`,
  );
  const standing = after.map((torpedo) => torpedo.id);
  for (const [index, id] of ids.entries()) {
    if (index === ADDRESSED) continue;
    assertContains(standing, id, `the torpedo ${id} still carrying its id`);
  }
});
