// Meltdown — combat/bloom-splash-boundary: the splash stops at its radius.
//
// specs/combat.md closes the splash rule with its far side: "a unit one logical unit
// outside it takes nothing", where `it` is the `2.4`-tile radius around the target's
// centre — `45.6` logical units (specs/floor.md gives `TILE` `19`). So a bystander
// `46.6` units from the impact must be untouched.
//
// ONE UNIT OUT RATHER THAN A COMFORTABLE MILE, BECAUSE THAT IS THE FIGURE THE
// SPECIFICATION FIXES. A bystander parked across the floor would pass on a build
// whose splash covers a quarter of the reactor. Posed one unit past the edge, this
// point fails a build that rounds the radius up to a whole three tiles, that
// measures the radius in tiles and compares it against logical units, that splashes
// over a tile box rather than a circle, or that splashes the whole floor. Its
// companion `combat/bloom-splashes` holds the near side, so the pair pins the radius
// to a single logical unit — and the two directions are split so that a failed grade
// says whether the splash is too small or too large.
//
// THE BYSTANDER STANDS DUE WEST, so its distance from the impact is one exact
// subtraction rather than a hypotenuse, and — since a unit entering the left vent is
// assigned the right exhaust — it keeps a larger `remaining` than the target and
// cannot be fired on itself. The check states that precondition, and that the target
// took its shot, before grading the bystander: a Bloom that never fired would
// otherwise pass this point for the wrong reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BLOOM_SPLASH, TILE } from "../../src/constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  eastOfGun,
  fireRateOf,
  poseGun,
  poseMarkAt,
  readGun,
  readHp,
  ticksForShots,
  unitOf,
} from "./duel";

/** The only emitter with a splash (specs/towers.md), and its pinned heat. */
const TOWER = "bloom";
const HEAT = 0;

/** specs/combat.md and specs/floor.md: 2.4 tiles of 19 units, so 45.6. */
const SPLASH_UNITS = BLOOM_SPLASH * TILE;

/** specs/combat.md: one logical unit past that radius takes nothing. */
const OUTSIDE_UNITS = SPLASH_UNITS + 1;

/**
 * Four tiles from the footprint centre: clear of the 3x3 footprint, and two tiles
 * inside the Bloom's `114`, so a build whose range is measured from the wrong point
 * still fires and is graded for that by `combat/range-from-the-footprint-centre`.
 */
const TARGET_UNITS = 76;

const TARGET = eastOfGun(TOWER, TARGET_UNITS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The splash stops at its radius", async () => {
  const gunId = poseGun(h, TOWER, HEAT);
  const target = poseMarkAt(h, "mote", TARGET.x, TARGET.y);
  const bystander = poseMarkAt(h, "mote", TARGET.x - OUTSIDE_UNITS, TARGET.y);

  const openedTarget = readHp(h, target);
  const openedBystander = readHp(h, bystander);

  await h.advance(ticksForShots(1, fireRateOf(TOWER)));
  captureStill(h, "boundary");
  const closing = h.snapshot();

  assertEqual(
    readGun(h, gunId).targeting,
    target,
    "precondition: the Bloom fired on the eastmost mark, so the impact is " +
      "where the radius is measured from",
  );
  assertGreaterThan(
    openedTarget - unitOf(closing, target).hp,
    0,
    `hp the ${TOWER}'s shot removed from its own target`,
  );
  assertEqual(
    openedBystander - unitOf(closing, bystander).hp,
    0,
    `hp removed from a bystander ${OUTSIDE_UNITS} units from the impact, one ` +
      `unit past the ${SPLASH_UNITS}-unit splash radius`,
  );
});
