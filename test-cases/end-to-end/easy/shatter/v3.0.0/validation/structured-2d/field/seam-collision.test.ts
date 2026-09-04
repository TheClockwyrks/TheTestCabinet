// field/seam-collision — a bullet posed just inside the left edge, travelling
// left, destroys a rock posed just inside the right edge on the same row.
//
// THE RULE. `specs/field.md` defines the separation between two positions as the
// shortest one across the seams, and says every rule in the specification that
// measures a distance between two bodies measures it that way.
// `specs/collision.md` applies that to every pair in one sentence: two bodies
// touch when the shortest wrapped separation between their centres, as
// `specs/field.md` defines it, is at most the sum of their radii, so bodies
// touching across a wrap seam collide. This is the item that decides it, and it
// is the half of the wrap a build most often leaves out: drawing across the seam
// is visible the first time anyone plays, and colliding across it is not.
//
// THE POSE, AND WHY EVERY FIGURE IN IT IS WHERE IT IS. The rock sits four units
// inside the right edge and the round starts twenty-two units inside the left,
// travelling left on the same row. Their shortest wrapped separation is 26 units
// against the `ROCK_RADIUS.small + BULLET_R` (`17`) at which they touch, so
// nothing is touching at the pose; three ticks of the round's own travel bring it
// to 13 and the pair is inside the sum of the radii, with the round still nine
// units clear of the seam it never reaches. Their PLAIN separation over the whole
// approach is more than 1250 units — a hundred times what touches — so a build
// measuring distance without the wrap has nothing to resolve, and a build
// measuring it with the wrap has an unambiguous overlap.
//
// WHY THE DRIVE IS BOUNDED AT FIVE TICKS. Because a build with a plain separation
// test does eventually destroy the rock: at 22 units and `MUZZLE_SPEED` the round
// reaches the seam on the sixth tick, wraps, and lands on top of a rock that is
// then plainly adjacent. The requirement is that the pair touching ACROSS the
// seam collides, so the reading has to close before the seam is crossed. Five
// ticks admits every build that resolves the pair across the seam — the pair is
// inside the sum of the radii from the third — and excludes the build that waited
// for the round to come round to it.
//
// WHY A SMALL. `ROCK_HEALTH.small` is `1` under `warhead` and a rock is destroyed
// by one round under `base`, so one round settles the item under both variants,
// and `ROCK_CHILD.small` is nothing, so the roster it leaves behind is empty. The
// row is far from the star, so neither body is near the core that would absorb
// the round or recycle the rock, and `startPlaying` has emptied the field, shut
// both world gates and shut the ship's contact test.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R, FIELD_W, MUZZLE_SPEED, ROCK_RADIUS } from "../constants";
import { assertTrue, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";

/** The row both bodies are posed on, well clear of the star and the HUD. */
const ROW = 200;

/** How far inside the right edge the rock's centre stands, in units. */
const ROCK_INSET = 4;

/** How far inside the left edge the round starts, in units. */
const BULLET_INSET = 22;

/** The sum of the radii at which `specs/collision.md` has the pair touch. */
const CONTACT = ROCK_RADIUS.small + BULLET_R;

/**
 * How long the round is driven for, in ticks.
 *
 * See the header: the pair is inside `CONTACT` from the third tick, and the round
 * cannot reach the seam itself before the sixth, so this ceiling is what makes
 * the item about touching across the seam rather than about touching eventually.
 */
const DRIVE_TICKS = 5;

/** The tick the still is taken on: both bodies in frame, closing across the seam. */
const STILL_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a rock the round is touching across the seam", async () => {
  startPlaying(h);

  const rock = poseRock(h, "small", FIELD_W - ROCK_INSET, ROW);
  const bullet = poseBullet(h, BULLET_INSET, ROW, -MUZZLE_SPEED, 0);

  await h.advance(STILL_TICKS);
  captureStill(h, "seam");

  const resolved = await h.until(
    (snapshot) => !snapshot.bullets.some((round) => round.id === bullet),
    { maxFrames: DRIVE_TICKS - STILL_TICKS, poll: 1 },
  );

  assertTrue(
    resolved.hit,
    `the round to resolve within ${DRIVE_TICKS} ticks, while it is still ` +
      `inside the left edge and touching the rock across the seam by ` +
      `${CONTACT} units`,
  );
  assertUndefined(
    resolved.snapshot.rocks.find((entry) => entry.id === rock),
    "the rock the round touched across the seam, which the hit destroys " +
      "(specs/collision.md)",
  );
});
