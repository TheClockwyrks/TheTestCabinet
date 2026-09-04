// instrumentation/snapshot-shape — over a posed field carrying a rock of each
// size, one of the ship's bullets, one saucer bullet and a saucer, `snapshot()`
// reports every field the Snapshot shape of `specs/instrumentation.md` lists, each
// with the type that document gives it.
//
// WHY THE FIELD IS POSED FULL FIRST. Half of the documented shape is inside the
// entries of four rosters, and an empty roster reports nothing to type-check. So
// one of every kind of body the surface can add is put up, and the shape is read
// off a field that really holds one of each.
//
// THE TWO DERIVED READINGS ARE CHECKED AS DERIVED. `specs/instrumentation.md` says
// `ship.speed` and `rocks[].radius` are "built at the call from the fields beside
// them" and that no operation sets either, so a build that stores a stale copy of
// one reports a number that disagrees with the fields it sits next to. Each is
// therefore held against what it is built from rather than merely typed.
//
// THE `warhead` HALF OF THE SHAPE IS DEMANDED OF A `warhead` BUILD ALONE. This
// script is on both checklists, and `specs/instrumentation.md` states `torpedoes`,
// `torpedoCharge`, `torpedoReady` and a rock's `health` under the variant, so a
// `base` build that reports none of them is correct. What separates the two is the
// surface itself: the torpedo operations are a `warhead` deliverable, so a build
// that carries `addTorpedo` is a build the variant's snapshot shape is required
// of. That reads the BUILD's own surface rather than its own snapshot, so a
// `warhead` build cannot escape the extra fields by omitting them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertContains,
  assertEqual,
  assertHasProperty,
  assertLength,
} from "../assert";
import { ROCK_RADIUS, ROCK_SIZES } from "../constants";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseEnemyBullet,
  poseRock,
  poseSaucer,
  requireSaucer,
  startPlaying,
  WARHEAD_OPS,
  type Harness,
  type ShotView,
} from "../harness";

/** Where the three rocks stand, one per size, spread and clear of the star. */
const ROCK_PLACES = [
  { size: "large", x: 200, y: 160 },
  { size: "medium", x: 1080, y: 160 },
  { size: "small", x: 200, y: 620 },
] as const;

/** Where the ship's one bullet sits. */
const BULLET_PLACE = { x: 1080, y: 620 } as const;

/** Where the one saucer bullet sits. */
const ENEMY_BULLET_PLACE = { x: 900, y: 660 } as const;

/** Where the saucer hangs, 260 units clear of the star's centre. */
const SAUCER_PLACE = { x: 640, y: 100 } as const;

/**
 * The partial charge `torpedoReady` is read at, under `warhead`.
 *
 * Half. `specs/instrumentation.md` makes the flag "true exactly when the charge is
 * 1", so anything strictly between `0` and `1` reads `false`; a half is far from
 * either end and is a value `specs/weapons.md` puts the charge at five seconds into
 * a recharge, so it is a charge a real run really holds.
 */
const PART_CHARGE = 0.5;

/** The velocity the ship is posed at, so `speed` has something to be built from. */
const SHIP_VELOCITY = { vx: 60, vy: -80 } as const;

/**
 * The decimal places `ship.speed` is held to against the fields beside it.
 *
 * Six, which is to say exactly: `specs/instrumentation.md` says the reading is
 * built at the call from `vx` and `vy`, so nothing but floating-point rounding
 * separates a conforming build's answer from the magnitude of the velocity it
 * reported on the same line.
 */
const DERIVED_DIGITS = 6;

let h: Harness;

/** Every field one shot — of the ship's, or of the saucer's — must report. */
function assertShotShape(shot: ShotView, what: string): void {
  for (const field of ["id", "x", "y", "vx", "vy", "life"] as const) {
    assertEqual(typeof shot[field], "number", `${what}.${field}`);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the whole documented snapshot shape over a populated field", async () => {
  await startPlaying(h);
  for (const place of ROCK_PLACES) {
    await poseRock(h, place.size, place.x, place.y);
  }
  await poseBullet(h, BULLET_PLACE.x, BULLET_PLACE.y, 0, 0);
  await poseEnemyBullet(h, ENEMY_BULLET_PLACE.x, ENEMY_BULLET_PLACE.y, 0, 0);
  await poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y, {
    vx: 0,
    vy: 0,
    mind: false,
    gun: false,
    travel: false,
  });
  await h.debug.setShipVelocity(SHIP_VELOCITY.vx, SHIP_VELOCITY.vy);
  await h.advance(1);
  await captureStill(h, "snapshot");

  const s = await h.snapshot();

  // The run, the screen and the two world gates.
  assertEqual(typeof s.version, "number", "version");
  assertContains(
    ["title", "howto", "playing", "paused", "gameover"],
    s.screen,
    "screen",
  );
  for (const field of [
    "menuIndex",
    "score",
    "lives",
    "wave",
    "waveBanner",
    "saucerClock",
    "saucerDue",
    "simTime",
  ] as const) {
    assertEqual(typeof s[field], "number", field);
  }
  for (const field of [
    "muted",
    "waveSpawning",
    "saucerSpawning",
    "autoStep",
  ] as const) {
    assertEqual(typeof s[field], "boolean", field);
  }

  // The ship.
  for (const field of [
    "x",
    "y",
    "vx",
    "vy",
    "angle",
    "speed",
    "invuln",
    "fireCooldown",
  ] as const) {
    assertEqual(typeof s.ship[field], "number", `ship.${field}`);
  }
  for (const field of ["thrusting", "collision"] as const) {
    assertEqual(typeof s.ship[field], "boolean", `ship.${field}`);
  }
  assertCloseTo(
    s.ship.speed,
    Math.hypot(s.ship.vx, s.ship.vy),
    DERIVED_DIGITS,
    "ship.speed is built from the velocity beside it",
  );

  // The rocks: one of each size, each carrying the radius its size fixes.
  assertLength(s.rocks, ROCK_PLACES.length, "the rock roster");
  for (const rock of s.rocks) {
    for (const field of ["id", "x", "y", "vx", "vy", "radius"] as const) {
      assertEqual(typeof rock[field], "number", `rocks[].${field}`);
    }
    assertContains(ROCK_SIZES, rock.size, "rocks[].size");
    assertEqual(
      rock.radius,
      ROCK_RADIUS[rock.size],
      `rocks[].radius for a ${rock.size}`,
    );
  }
  for (const size of ROCK_SIZES) {
    assertContains(
      s.rocks.map((rock) => rock.size),
      size,
      "a rock of every size was posed",
    );
  }

  // The two shot rosters.
  assertLength(s.bullets, 1, "the bullet roster");
  assertShotShape(s.bullets[0], "bullets[]");
  assertLength(s.enemyBullets, 1, "the enemy-bullet roster");
  assertShotShape(s.enemyBullets[0], "enemyBullets[]");

  // The saucer slot, which is an object while one is up.
  const saucer = requireSaucer(s, "the posed saucer");
  for (const field of [
    "id",
    "x",
    "y",
    "vx",
    "vy",
    "fireClock",
    "weaveClock",
    "age",
  ] as const) {
    assertEqual(typeof saucer[field], "number", `saucer.${field}`);
  }
  for (const field of ["mind", "gun", "travel"] as const) {
    assertEqual(typeof saucer[field], "boolean", `saucer.${field}`);
  }

  // And the four fields the variant adds, demanded of a build whose surface
  // carries the variant's operations.
  const probed = await h.probe(WARHEAD_OPS);
  if (probed.ops.addTorpedo === "function") {
    assertHasProperty(s, "torpedoes", "the warhead torpedo roster");
    assertEqual(
      Array.isArray(s.torpedoes),
      true,
      "torpedoes is a roster (specs/instrumentation.md)",
    );
    assertEqual(typeof s.torpedoCharge, "number", "torpedoCharge");
    assertBetween(s.torpedoCharge ?? -1, 0, 1, "torpedoCharge runs 0 to 1");
    assertEqual(typeof s.torpedoReady, "boolean", "torpedoReady");
    for (const rock of s.rocks) {
      assertEqual(typeof rock.health, "number", "rocks[].health");
    }

    // `torpedoReady` is the variant's third derived reading, and it is checked
    // the way the other two are: against what it is built from. The charge is
    // posed BOTH SIDES of the one value that makes it true, because a build that
    // reports the flag from any partial charge reads identically to a conforming
    // one at the full charge a new run opens with.
    await h.debug.setTorpedoCharge(PART_CHARGE);
    const part = await h.snapshot();
    assertCloseTo(
      part.torpedoCharge ?? -1,
      PART_CHARGE,
      DERIVED_DIGITS,
      "setTorpedoCharge",
    );
    assertEqual(
      part.torpedoReady,
      false,
      `torpedoReady at a charge of ${PART_CHARGE}`,
    );

    await h.debug.setTorpedoCharge(1);
    assertEqual(
      (await h.snapshot()).torpedoReady,
      true,
      "torpedoReady at a full charge",
    );
  }
});
