// contact/contact-overlap-strict — the overlap test is a strict inequality on
// the radii's sum.
//
// THE SPEC LINE. `specs/world.md`, "Contact damage": "the enemy's circle
// overlaps the lamplighter's when the distance between their centers is less
// than the enemy's radius plus `PLAYER_RADIUS`". A rat's radius is `12`
// (`specs/enemies.md`) and `PLAYER_RADIUS` is `12`, so the bound is `24`: a rat
// whose center is exactly `24` units away does not overlap, and one at `23.9`
// does.
//
// WHY BOTH SIDES OF THE BOUND, IN ONE POINT. `contact-hit` already grades that
// a rat well inside the bound hits. What this point decides is WHERE the bound
// falls and that it is strict, and that is one fact with two faces: a build
// that tests `<=` hits at `24`, and a build whose bound is `2 × PLAYER_RADIUS`
// or the enemy radius alone misses at `23.9`. So the rat is posed at exactly
// `24` for `60` ticks and hp must not move, then a rat at `23.9` for one tick
// and hp must fall. Sixty ticks at the bound is two whole `CONTACT_COOLDOWN`
// intervals, more than enough for a hit to have landed had the build counted
// `24` as overlap, since a fresh rat's cooldown is due on every tick.
//
// WHY THE POSES ARE EXACT. `spawnEnemy` centers the rat at the given point and
// `enemyMotion` is off, so the rat holds that point across the whole span:
// "Every enemy holds its position and heading" (`specs/instrumentation.md`).
// The lamplighter stands at the origin and no movement key is held, so the
// center distance is the posed `x` to the last bit, and the strict bound is
// tested at exactly `24`, not at `24` plus a step of drift.
//
// THE TOLERANCE. Whether hp moved at all is read exactly, the hit at `23.9` to
// `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  CONTACT_COOLDOWN,
  ENEMIES,
  PLAYER_RADIUS,
  REAL_EPS,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The overlap bound for a rat: its radius plus the lamplighter's. */
const BOUND = ENEMIES.rat.radius + PLAYER_RADIUS;

/** A tenth of a unit inside the bound: the nearest figure the tables distinguish. */
const INSIDE = BOUND - 0.1;

/** Ticks the rat at the bound is watched for: two whole contact intervals. */
const WATCH = 2 * ticksOf(CONTACT_COOLDOWN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands no hit at exactly the radii's sum and a hit a tenth inside it", async () => {
  const before = isolate(h);
  enable(h, "enemyContact");

  const atBound = placeEnemyNear(h, "rat", BOUND, 0);
  const held = await advanceTicks(h, WATCH);
  assertEqual(
    held.run.player.hp,
    before.run.player.hp,
    `hp after ${WATCH} ticks with a rat centered exactly ${BOUND} units away (specs/world.md, Contact damage)`,
  );

  h.debug.removeEnemy(atBound);
  placeEnemyNear(h, "rat", INSIDE, 0);
  const struck = await advanceTicks(h, 1);
  captureStill(h, "boundary");

  assertNear(
    struck.run.player.hp,
    before.run.player.hp - ENEMIES.rat.damage,
    REAL_EPS,
    `hp after one tick with a rat centered ${INSIDE} units away (specs/world.md, Contact damage)`,
  );
});
