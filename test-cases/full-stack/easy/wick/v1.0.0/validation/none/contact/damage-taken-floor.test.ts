// contact/damage-taken-floor — a contact hit removes at least
// MIN_DAMAGE_TAKEN.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): "Least
// health a hit removes | `MIN_DAMAGE_TAKEN` | `1`", and the rule "`hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`". specs/passives.md ("Armor")
// says the same: "every contact hit that lands removes at least `1` health
// whatever the armor. Brass tops out at level `3`, so armor is at most `3`." A
// gnat's damage is 3 (specs/enemies.md — "Gnat | `gnat` | 2 | 160 | 3 | 8"), so
// with Brass 3 held `3 - 3` is 0 and the floor makes the hit remove exactly 1:
// `hp` reads 99 from full.
//
// 3 - 3 IS THE BOUNDARY, and it is posed deliberately: the floor is what
// separates a hit that removes 1 from one that removes nothing, and a build
// that skipped the `max` reads 100 here.
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off,
// Brass at its max level 3 held through `setPassive`, and one gnat 5 units from
// the lamplighter's center, well inside its radius 8 plus `PLAYER_RADIUS` 12.
// A gnat drifts rather than chases, and with `enemyMotion` off it holds where
// it was posed either way. Its cooldown is the 0 it spawned with, so it hits on
// the first tick. Recovery is 0 with no Tinder held.
//
// THE TOLERANCE. `FLOAT_TOL`: `100 - 1` is exact, and a build that removed
// nothing is a whole unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  BASE_MAX_HP,
  ENEMIES,
  FLOAT_TOL,
  MIN_DAMAGE_TAKEN,
  PASSIVES,
  armorOf,
  damageTaken,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** Brass at its max level: armor 3, equal to a gnat's damage. */
const BRASS_LEVEL = PASSIVES.brass.maxLevel;

/** How far from the center the gnat is posed: well inside 8 + 12. */
const GNAT_OFFSET = 5;

/** `100 - max(1, 3 - 3)`, which is `100 - MIN_DAMAGE_TAKEN`. */
const EXPECTED_HP =
  BASE_MAX_HP -
  damageTaken(ENEMIES.gnat.damage, armorOf({ brass: BRASS_LEVEL }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes exactly 1 from hp on a gnat's hit with Brass 3 held", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await holdPassive(h, "brass", BRASS_LEVEL);
  await placeEnemyNear(h, "gnat", GNAT_OFFSET, 0);

  const after = await h.step(1);

  // The HUD with the floored hit landed. Captured before the assertion, so a
  // failing build leaves the picture that shows why.
  await captureStill(h, "floor");

  assertNear(
    player(after).hp,
    EXPECTED_HP,
    FLOAT_TOL,
    `hp after one gnat hit against armor equal to its damage (floor ${MIN_DAMAGE_TAKEN})`,
  );
});
