// flare/hits-all-in-radius — the burst hits every enemy within radius, and
// the boundary is inclusive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"): "every enemy
// within `radius` of the player's center takes `damage` on that tick", with
// row 1's radius of 640 from the level table. ("Shapes and overlap") fixes
// what "within" means for a test stated against a center: "An enemy is within
// `d` of a point when the distance from that point to the enemy's center is
// at most `d`" — at most, so an enemy whose center is exactly 640 from the
// lamplighter's center is inside the burst and one at 640.5 is outside it.
// The enemy's own radius does not enter: this weapon's section states its
// test as a distance to the enemy's center, which "Shapes and overlap" allows
// "where a weapon's section says its test is distance to the enemy's center
// instead". ("Hits and death") "A hit removes the shape's damage per hit from
// the enemy's `hp`" and "On any tick an enemy's `hp` is at or below `0` after
// the hits the enemy dies on that tick", so a moth's 5 hp
// (`specs/enemies.md`) against row 1's damage of 100 makes a hit visible as
// the moth being gone and no hit visible as the moth standing at the 5 hp it
// was posed with.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with six moths, five of
// them at 100, 300, 500, 620, and 640 units from the lamplighter's center and
// one at 640.5, and Flare held at level 1 with its timer at 0, `weaponFire`
// on and every other switch off, so the first tick fires once and nothing but
// the burst can reach a moth. Each post lies on an axis through the
// lamplighter, so its distance is the coordinate itself and no rounding
// stands between the boundary post and the bound it is testing; the posts run
// in four directions so no two moths stand on each other. `enemyMotion` is
// off, so every moth is at its post on the firing tick, `enemyContact` is
// off, so none of them reaches the lamplighter, and `despawning` is off, so
// the post beyond the burst is still there to read.
//
// THE TOLERANCE. None: what is read of each moth is whether the tick took
// damage off it, a yes or no. `REAL_EPS` separates a lowered `hp` from an
// untouched one, one subtraction of a table figure below the posed value.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FLARE_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
  type Point,
} from "../harness";
import { armFlare, hpOf, tookDamage } from "./burst";

/** The row under test: radius 640. */
const LEVEL = 1;
const RADIUS = FLARE_LEVELS[LEVEL - 1].radius;

/**
 * The five posts inside the burst, each on an axis through the lamplighter so
 * its distance is exactly the coordinate: 100, 300, 500, 620, and the
 * boundary itself at 640.
 */
const INSIDE_POSTS: readonly Point[] = [
  { x: 100, y: 0 },
  { x: 0, y: 300 },
  { x: -500, y: 0 },
  { x: 0, y: -620 },
  { x: RADIUS, y: 0 },
];

/** The post just outside the burst: half a unit past the boundary. */
const OUTSIDE_POST: Point = { x: -(RADIUS + 0.5), y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("damages the moths at 100, 300, 500, 620, and 640 and leaves the one at 640.5 untouched", async () => {
  isolate(h);
  const inside = INSIDE_POSTS.map((post) =>
    placeEnemyNear(h, "moth", post.x, post.y),
  );
  const outside = placeEnemyNear(h, "moth", OUTSIDE_POST.x, OUTSIDE_POST.y);
  armFlare(h, LEVEL);
  const posed = h.snapshot();
  const before = [...inside, outside].map((id) => hpOf(posed, id));

  const fired = await advanceTicks(h, 1);
  captureStill(h, "burst");

  for (const [index, id] of inside.entries()) {
    const post = INSIDE_POSTS[index];
    assertEqual(
      tookDamage(fired, id, before[index]),
      true,
      `whether the burst damaged the moth ${Math.hypot(post.x, post.y)} from the lamplighter, at most the radius of ${RADIUS} away`,
    );
  }
  assertEqual(
    tookDamage(fired, outside, before[inside.length]),
    false,
    `whether the burst damaged the moth ${Math.hypot(OUTSIDE_POST.x, OUTSIDE_POST.y)} from the lamplighter, past the radius of ${RADIUS}`,
  );
});
