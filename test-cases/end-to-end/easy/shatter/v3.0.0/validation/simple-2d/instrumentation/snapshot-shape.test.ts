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
// THE FIELD LIST IS THE SPECIFICATION'S, NOT THIS FILE'S. `surface.ts` is
// `specs/instrumentation.md` written down as types, and its `SNAPSHOT_FIELDS`,
// `SHIP_FIELDS`, `BULLET_FIELDS`, `ROCK_FIELDS` and `SAUCER_FIELDS` tables are that
// document's own inventory. Walking them is what keeps this point held against the
// specification rather than against a list a validator author copied out by hand.
// Its `TORPEDO_FIELDS` is walked the same way by
// `instrumentation/warhead-snapshot-shape`.
//
// THE TWO DERIVED READINGS ARE CHECKED AS DERIVED. `specs/instrumentation.md` says
// `ship.speed` and `rocks[].radius` are "built at the call from the fields beside
// them" and that no operation sets either, so a build that stores a stale copy of
// one reports a number that disagrees with the fields it sits next to. Each is
// therefore held against what it is built from rather than merely typed.
//
// THE SHAPE READ HERE IS THE COMMON ONE, ON BOTH CHECKLISTS. `specs/instrumentation.md`
// states `torpedoes`, `torpedoCharge`, `torpedoReady` and a rock's `health` under the
// `warhead` variant alone, and those four are read by
// `instrumentation/warhead-snapshot-shape`, an item of the warhead checklist alone.
// They are NOT read here behind a probe of the build's own surface, which is what this
// script used to do: a requirement gated on whether the build installed `addTorpedo`
// is one any build can shed by implementing less, so a `warhead` build that wrote no
// torpedo would pass this point on the strength of its omission while one that wrote
// the torpedo and mistyped a field would fail. A suite is named by a variant's
// checklist, so it already knows which variant it is grading.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS } from "../constants";
import {
  assertCloseTo,
  assertContains,
  assertEqual,
  assertHasProperty,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseEnemyBullet,
  poseRock,
  startPlaying,
  theSaucer,
  type Harness,
} from "../harness";
import {
  BULLET_FIELDS,
  POSED_DRAW_FIELDS,
  ROCK_FIELDS,
  SAUCER_FIELDS,
  SHIP_FIELDS,
  SNAPSHOT_FIELDS,
  type RockSize,
} from "../surface";
import { poseIdleSaucer } from "./populated-field";

/** The five screens `specs/instrumentation.md` names, as `screen` may report. */
const SCREENS = ["title", "howto", "playing", "paused", "gameover"] as const;

/** The three rock sizes, `specs/rocks.md`, as `rocks[].size` may report. */
const SIZES: readonly RockSize[] = ["large", "medium", "small"];

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

/** Every field of `table` is present on `value` with the type the table gives it. */
function assertShape(
  value: object,
  table: Readonly<Record<string, string>>,
  what: string,
): void {
  const record = value as Record<string, unknown>;
  for (const [field, kind] of Object.entries(table)) {
    assertHasProperty(value, field, `${what}.${field}`);
    assertEqual(typeof record[field], kind, `${what}.${field}`);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the whole documented snapshot shape over a populated field", async () => {
  startPlaying(h);
  for (const place of ROCK_PLACES) poseRock(h, place.size, place.x, place.y);
  poseBullet(h, BULLET_PLACE.x, BULLET_PLACE.y, 0, 0);
  poseEnemyBullet(h, ENEMY_BULLET_PLACE.x, ENEMY_BULLET_PLACE.y, 0, 0);
  poseIdleSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y);
  h.debug.setShipVelocity(SHIP_VELOCITY.vx, SHIP_VELOCITY.vy);
  await h.advance(1);
  captureStill(h, "snapshot");

  const s = h.snapshot();

  // Every top-level field the document lists, with the type it gives it.
  assertShape(s, SNAPSHOT_FIELDS, "snapshot()");
  // And the five posed draws, present and `null` while no pose stands.
  for (const field of POSED_DRAW_FIELDS) {
    assertHasProperty(s, field, `snapshot().${field}`);
    assertEqual(s[field], null, `snapshot().${field} with no pose standing`);
  }
  assertContains(SCREENS, s.screen, "snapshot().screen");

  // The ship, and the reading built from the velocity beside it.
  assertShape(s.ship, SHIP_FIELDS, "snapshot().ship");
  assertCloseTo(
    s.ship.speed,
    Math.hypot(s.ship.vx, s.ship.vy),
    DERIVED_DIGITS,
    "ship.speed is built from the velocity beside it",
  );

  // The rocks: one of each size, each carrying the radius its size fixes.
  assertLength(s.rocks, ROCK_PLACES.length, "the rock roster");
  for (const rock of s.rocks) {
    assertShape(rock, ROCK_FIELDS, "snapshot().rocks[]");
    assertContains(SIZES, rock.size, "snapshot().rocks[].size");
    assertEqual(
      rock.radius,
      ROCK_RADIUS[rock.size],
      `rocks[].radius for a ${rock.size} (specs/rocks.md)`,
    );
  }
  for (const size of SIZES) {
    assertContains(
      s.rocks.map((rock) => rock.size),
      size,
      "a rock of every size was posed",
    );
  }

  // The two shot rosters.
  assertLength(s.bullets, 1, "the bullet roster");
  assertShape(s.bullets[0], BULLET_FIELDS, "snapshot().bullets[]");
  assertLength(s.enemyBullets, 1, "the enemy-bullet roster");
  assertShape(s.enemyBullets[0], BULLET_FIELDS, "snapshot().enemyBullets[]");

  // The saucer slot, which is an object while one is up.
  assertShape(
    theSaucer(s, "the posed saucer"),
    SAUCER_FIELDS,
    "snapshot().saucer",
  );
});
