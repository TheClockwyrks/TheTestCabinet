// instrumentation/remove-bullet — `removeBullet(id)` removes exactly the one of the
// ship's bullets that id names, and leaves the others in flight carrying their own
// ids.
//
// THREE BULLETS, AND THE ONE ADDRESSED IS THE MIDDLE OF THEM.
// `specs/instrumentation.md` makes every bullet's id "distinct among the entities
// live at any moment" and has every per-entity operation take one, so the fault
// this is hunting is an operation that removes by POSITION rather than by identity
// — the first of the roster, the last of it, or the one whose index happened to
// match the number it was handed. Naming the middle entry tells all three apart
// from the right answer.
//
// AND THE SURVIVORS ARE READ BY ID RATHER THAN COUNTED. A roster of the right
// length can still be the wrong two bullets.
//
// NOTHING ELSE IS ON THE FIELD, and the three are placed at rest and far apart, so
// nothing but the operation can take one off the roster: `specs/weapons.md` gives a
// bullet a life of `BULLET_LIFE` and `specs/collision.md` removes one that lands or
// reaches the core, and neither has anything to happen to here.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  startPlaying,
  type Harness,
} from "../harness";

/** Where the three bullets sit: spread, at rest, and well clear of the star. */
const PLACES = [
  { x: 200, y: 160 },
  { x: 1080, y: 160 },
  { x: 200, y: 620 },
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

it("removes the bullet its id names and no other", async () => {
  startPlaying(h);
  const ids = PLACES.map((place) => poseBullet(h, place.x, place.y, 0, 0));
  await h.advance(1);
  assertLength(
    h.snapshot().bullets,
    PLACES.length,
    "the bullets the field held",
  );

  h.debug.removeBullet(ids[ADDRESSED]);
  await h.advance(1);
  captureStill(h, "removed");
  const after = h.snapshot();

  assertLength(
    after.bullets,
    PLACES.length - 1,
    "the bullets that outlived it",
  );
  assertUndefined(
    after.bullets.find((bullet) => bullet.id === ids[ADDRESSED]),
    `the bullet ${ids[ADDRESSED]} removeBullet was handed`,
  );
  const flying = after.bullets.map((bullet) => bullet.id);
  for (const [index, id] of ids.entries()) {
    if (index === ADDRESSED) continue;
    assertContains(flying, id, `the bullet ${id} still carrying its id`);
  }
});
