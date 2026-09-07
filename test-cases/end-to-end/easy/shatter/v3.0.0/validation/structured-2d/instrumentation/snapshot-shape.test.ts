// instrumentation/snapshot-shape — on a posed field carrying a rock of each
// size, a bullet, an enemy bullet and a saucer, the snapshot reports every
// field the specification's Snapshot shape block lists, with its documented
// type.
//
// THE RULE. `specs/instrumentation.md`, Snapshot shape: "`snapshot` returns
// exactly this object. Every field an operation can set is present, so every
// operation is verifiable by setting a value and reading it back." That is the
// rule every other item in this group stands on: a check that poses a value and
// reads it back can only do so through a snapshot that reports the field.
//
// WHY THE FIELD IS FULL. Three entries of the shape are conditional on what is
// on the field — a rock's row exists only for a posed rock, the saucer is
// `null` when none is up, and the two bullet rosters are empty until something
// is in flight — so a shape read off a bare title screen would report four
// empty arrays and a null and say nothing at all. `scene.ts` poses one of every
// kind at once, which is the one field on which every branch of the shape is
// present.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. Presence and documented TYPE, plus the two
// entries the specification says are BUILT AT THE CALL rather than stored:
// `ship.speed` is the magnitude of the velocity beside it, and `rocks[].radius`
// is the radius the rock's size fixes in `specs/collision.md`. What each field
// is worth after a pose is `poses-read-back`'s; what `reset` puts in it is
// `reset-restores-title`'s. This item is the shape.
//
// THE WARHEAD ROWS ARE NOT HERE. `specs/instrumentation.md` adds `torpedoes`,
// `torpedoCharge` and `torpedoReady` to the shape under the `warhead` variant
// alone, and this script is a COMMON one — it is named by both checklists. So
// those three are `instrumentation/warhead-snapshot-shape`, an item of the
// warhead checklist alone. They used to be required here of exactly the surface
// that carried `addTorpedo`, and a requirement decided that way is one a build
// can shed by implementing less: a `warhead` build that wrote no torpedo passed
// this point on the strength of its omission, while one that wrote the torpedo
// and mistyped a field failed it.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS } from "../constants";
import {
  assertCloseTo,
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  requireRock,
  requireSaucer,
  type BulletSnapshot,
  type Harness,
} from "../harness";
import {
  REQUIRED_SHIP_FIELDS,
  POSED_DRAW_FIELDS,
  REQUIRED_SNAPSHOT_FIELDS,
  SHATTER_DEBUG_VERSION,
  type ShatterSnapshot,
} from "../surface";
import { posePopulatedField, SIZES } from "./scene";

/** The five screens `specs/ui.md` fixes, which `screen` is one of. */
const SCREENS = ["title", "howto", "playing", "paused", "gameover"] as const;

/**
 * How closely `ship.speed` must equal the magnitude of the velocity beside it.
 *
 * `specs/instrumentation.md` has it BUILT AT THE CALL from those two fields, so
 * the two agree to the arithmetic that produced them; six decimal places is a
 * double's own precision over figures of this size and nothing looser.
 */
const SPEED_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every documented field of one round in flight, whichever roster it is in. */
function assertBulletShape(bullet: BulletSnapshot, at: string): void {
  for (const field of ["id", "x", "y", "vx", "vy", "life"] as const) {
    assertEqual(typeof bullet[field], "number", `${at}: ${field} is a number`);
  }
}

it("reports every documented field, with its documented type", async () => {
  const posed = posePopulatedField(h);

  // Read with nothing advanced: a pose acts on the live game at the call, so
  // the shape is read of exactly the field that was arranged.
  const snapshot: ShatterSnapshot = h.snapshot();

  // The frame the shape describes, kept as this point's evidence.
  await h.advance(1);
  captureStill(h, "snapshot");

  for (const field of REQUIRED_SNAPSHOT_FIELDS) {
    assertHasProperty(snapshot, field, "a documented snapshot field");
  }

  assertEqual(snapshot.version, SHATTER_DEBUG_VERSION, "version");
  assertContains(SCREENS, snapshot.screen, "screen is one of the five");
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
    assertEqual(typeof snapshot[field], "number", `${field} is a number`);
  }
  for (const field of ["muted", "waveSpawning", "saucerSpawning"] as const) {
    assertEqual(typeof snapshot[field], "boolean", `${field} is a boolean`);
  }
  // The five posed draws, present and `null` while no pose stands.
  for (const field of POSED_DRAW_FIELDS) {
    assertEqual(
      snapshot[field],
      null,
      `${field} is null with no pose standing`,
    );
  }
  assertGreaterThanOrEqual(snapshot.simTime, 0, "simTime accumulates from 0");

  // The ship: every documented field, and `speed` built from the velocity.
  for (const field of REQUIRED_SHIP_FIELDS) {
    assertHasProperty(snapshot.ship, field, "a documented ship field");
  }
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
    assertEqual(
      typeof snapshot.ship[field],
      "number",
      `ship.${field} is a number`,
    );
  }
  for (const field of ["thrusting", "collision"] as const) {
    assertEqual(
      typeof snapshot.ship[field],
      "boolean",
      `ship.${field} is a boolean`,
    );
  }
  assertCloseTo(
    snapshot.ship.speed,
    Math.hypot(snapshot.ship.vx, snapshot.ship.vy),
    SPEED_DIGITS,
    "ship.speed is the magnitude of the velocity, built at the call",
  );

  // The rocks: one of each size, each with its documented fields and the
  // collision radius its size fixes (specs/collision.md).
  assertTrue(Array.isArray(snapshot.rocks), "rocks is an array");
  assertLength(snapshot.rocks, SIZES.length, "one rock of each posed size");
  for (const size of SIZES) {
    const rock = requireRock(snapshot, posed.rocks[size], `the posed ${size}`);
    for (const field of ["id", "x", "y", "vx", "vy", "radius"] as const) {
      assertEqual(
        typeof rock[field],
        "number",
        `the ${size}: ${field} is a number`,
      );
    }
    assertEqual(rock.size, size, `the ${size}: size`);
    assertEqual(
      rock.radius,
      ROCK_RADIUS[size],
      `the ${size}: radius is the one its size fixes (specs/collision.md)`,
    );
  }

  // Both bullet rosters, in roster order, each entry whole.
  assertTrue(Array.isArray(snapshot.bullets), "bullets is an array");
  assertTrue(Array.isArray(snapshot.enemyBullets), "enemyBullets is an array");
  snapshot.bullets.forEach((bullet, index) =>
    assertBulletShape(bullet, `bullets[${index}]`),
  );
  snapshot.enemyBullets.forEach((bullet, index) =>
    assertBulletShape(bullet, `enemyBullets[${index}]`),
  );

  // The saucer, up, with its centre, its velocity and its three faculties.
  const saucer = requireSaucer(snapshot, "the posed saucer");
  for (const field of [
    "id",
    "x",
    "y",
    "vx",
    "vy",
    "fireClock",
    "weaveClock",
    "age",
    "weave",
  ] as const) {
    assertEqual(typeof saucer[field], "number", `saucer.${field} is a number`);
  }
  for (const field of ["mind", "gun", "travel"] as const) {
    assertEqual(
      typeof saucer[field],
      "boolean",
      `saucer.${field} is a boolean`,
    );
  }
});
