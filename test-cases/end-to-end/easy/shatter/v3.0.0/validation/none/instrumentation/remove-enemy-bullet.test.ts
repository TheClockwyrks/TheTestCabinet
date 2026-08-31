// instrumentation/remove-enemy-bullet — `removeEnemyBullet(id)` removes exactly the
// saucer bullet that id names, and leaves the others in flight carrying their own
// ids.
//
// THREE BULLETS, AND THE ONE ADDRESSED IS THE MIDDLE OF THEM. `specs/instrumentation.md`
// makes every saucer bullet's id "distinct among the entities live at any moment"
// and has every per-entity operation take one, so the fault this is hunting is an
// operation that removes by POSITION rather than by identity — the first of the
// roster, the last of it, or the one whose index happened to match the number it was
// handed. Naming the middle entry tells all three apart from the right answer.
//
// THE SHIP'S OWN BULLETS ARE NOT ON THE FIELD. They are a separate roster with a
// separate operation, and the item that decides that one is `remove-bullet`; what
// is posed here is the roster this operation addresses and nothing else.
//
// AND NO SAUCER IS UP EITHER. `specs/saucer.md` gives a bullet its own life once it
// is fired, so a bullet on the field needs no craft behind it — and a saucer that
// was up would be firing fresh rounds onto the roster this counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBulletById,
  poseEnemyBullet,
  startPlaying,
  type Harness,
} from "../harness";

/** Where the three saucer bullets sit: spread, at rest, well clear of the star. */
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

afterEach(async () => {
  await h.dispose();
});

it("removes the saucer bullet its id names and no other", async () => {
  await startPlaying(h);
  const ids: number[] = [];
  for (const place of PLACES) {
    ids.push(await poseEnemyBullet(h, place.x, place.y, 0, 0));
  }
  await h.advance(1);
  assertLength(
    (await h.snapshot()).enemyBullets,
    PLACES.length,
    "the saucer bullets the field held",
  );

  await h.debug.removeEnemyBullet(ids[ADDRESSED]);
  await h.advance(1);
  await captureStill(h, "removed");
  const after = await h.snapshot();

  assertLength(
    after.enemyBullets,
    PLACES.length - 1,
    "the saucer bullets that outlived it",
  );
  assertEqual(
    enemyBulletById(after, ids[ADDRESSED]),
    undefined,
    `the saucer bullet ${ids[ADDRESSED]} removeEnemyBullet was handed`,
  );
  const flying = after.enemyBullets.map((bullet) => bullet.id);
  for (const [index, id] of ids.entries()) {
    if (index === ADDRESSED) continue;
    assertContains(flying, id, `the saucer bullet ${id} still carrying its id`);
  }
});
