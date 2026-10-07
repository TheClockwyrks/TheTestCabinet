// instrumentation/remove-rock — `removeRock(id)` removes exactly the rock that id
// names, and leaves every other rock on the field carrying its own id.
//
// THREE ROCKS, AND THE ONE ADDRESSED IS THE MIDDLE OF THEM.
// `specs/instrumentation.md` makes every rock's id "distinct among the entities
// live at any moment" and has every per-entity operation take one, so the fault
// this is hunting is an operation that removes by POSITION rather than by identity
// — the first of the roster, the last of it, or the one whose index happened to
// match the number it was handed. Naming the middle entry tells all three apart
// from the right answer: a build that removed the first leaves a roster missing the
// wrong id, and so does a build that removed the last.
//
// AND THE SURVIVORS ARE READ BY ID RATHER THAN COUNTED. A roster of the right
// length can still be the wrong two rocks, and a build that removed one and
// re-created another would pass a count.
//
// NOTHING ELSE IS ON THE FIELD. The requirement is about one roster, so only that
// roster is posed: no bullet, no saucer, and the ship's contact gate shut, which is
// what `startPlaying` leaves. The three stand at rest and far apart, so nothing but
// the operation can take one off the roster.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";

/** Where the three rocks stand: spread, at rest, and well clear of the star. */
const PLACES = [
  { size: "large", x: 200, y: 160 },
  { size: "medium", x: 1080, y: 160 },
  { size: "small", x: 200, y: 620 },
] as const;

/** Which of the three is addressed: the middle one, so neither end is the answer. */
const ADDRESSED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the rock its id names and no other", async () => {
  startPlaying(h);
  const ids = PLACES.map((place) => poseRock(h, place.size, place.x, place.y));
  await h.advance(1);
  assertLength(h.snapshot().rocks, PLACES.length, "the rocks the field held");

  h.debug.removeRock(ids[ADDRESSED]);
  await h.advance(1);
  captureStill(h, "removed");
  const after = h.snapshot();

  assertLength(after.rocks, PLACES.length - 1, "the rocks that outlived it");
  assertUndefined(
    after.rocks.find((rock) => rock.id === ids[ADDRESSED]),
    `the rock ${ids[ADDRESSED]} removeRock was handed`,
  );
  const standing = after.rocks.map((rock) => rock.id);
  for (const [index, id] of ids.entries()) {
    if (index === ADDRESSED) continue;
    assertContains(standing, id, `the rock ${id} still carrying its id`);
  }
});
