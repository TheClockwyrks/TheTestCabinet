// contact/contact-overlap-strict — contact needs the centers STRICTLY closer
// than the radii's sum: a rat at exactly 24 units lands no hit, one at 23.9 does.
//
// THE RULE, FROM THE SPEC. specs/world.md, Contact damage: "the enemy's circle
// overlaps the lamplighter's when the distance between their centers is less
// than the enemy's radius plus PLAYER_RADIUS". A rat's radius is 12
// (specs/enemies.md) and PLAYER_RADIUS is 12 (specs/world.md), so the boundary
// is 24: a distance of exactly 24 is not less than 24 and overlaps nothing,
// and 23.9 is.
//
// WHY BOTH SIDES OF THE BOUNDARY. A build that wrote `<=` hits at 24 and fails
// the first scenario; a build whose overlap test is broken altogether hits at
// neither and fails the second. Both scenarios are the same rule, read at the
// boundary from each side, so they decide this one item together.
//
// THE POSE. An isolated night with enemyContact on and nothing else moving or
// firing. The rat is posed along +x alone, so its distance is its x offset
// exactly, 24 or 23.9, with no rounding in the hypotenuse. Its cooldown is 0 at
// spawn and "a timer at 0 stays due on every tick" (specs/world.md, Timers), so
// across 60 ticks any overlap would have landed a hit; recovery is 0 with no
// Tinder held, so hp holds at the fresh run's 100 exactly when nothing hit.
//
// THE TOLERANCE. hp untouched is an exact equality, 100 read back as posed. The
// hit at 23.9 reads 100 − 8 within FIGURE_TOLERANCE, exact arithmetic on stated
// figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  ENEMIES,
  FIGURE_TOLERANCE,
  PLAYER_RADIUS,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy at the boundary: radius 12, damage 8. */
const TYPE = "rat";

/** The radii's sum: the distance at which overlap stops. */
const BOUNDARY = ENEMIES[TYPE].radius + PLAYER_RADIUS;

/** A tenth of a unit inside the boundary. */
const INSIDE = BOUNDARY - 0.1;

/** How long the boundary pose is watched for a hit that must never land. */
const WATCH_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands no hit across 60 ticks with the rat's center exactly 24 units away", async () => {
  isolate(h);
  enable(h, "enemyContact");
  spawnEnemyNear(h, TYPE, BOUNDARY, 0);

  const after = await h.tick(WATCH_TICKS);
  captureStill(h, "boundary");

  assertEqual(
    after.run.player.hp,
    BASE_MAX_HP,
    `hp after ${WATCH_TICKS} ticks with the rat at exactly ${BOUNDARY}`,
  );
});

it("hits on the next tick with the rat's center 23.9 units away", async () => {
  isolate(h);
  enable(h, "enemyContact");
  spawnEnemyNear(h, TYPE, INSIDE, 0);

  const after = await h.tick(1);

  assertWithin(
    after.run.player.hp,
    BASE_MAX_HP - ENEMIES[TYPE].damage,
    FIGURE_TOLERANCE,
    `hp after one tick with the rat at ${INSIDE}`,
  );
});
