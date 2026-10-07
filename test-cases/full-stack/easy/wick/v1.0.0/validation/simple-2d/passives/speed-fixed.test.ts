// passives/speed-fixed — a projectile's speed is one of the figures no passive
// touches.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("What passives leave as
// written"): "Every figure a passive does not name above is used exactly as its
// table or constant states it. Projectile `speed` and `duration` are used as
// written for every weapon, at every passive level, so a bolt travels the same
// distance ... whatever the passives held". specs/weapons.md ("Derived stats")
// puts speed in the row "Speed, Pierce, Duration | table value, unchanged".
// Row 1 of EMBER_LEVELS gives speed 400 (specs/weapons.md, "Ember"), and
// specs/weapons.md ("Ember") has the bolt "fired from the player's center at
// `speed`", so the length of its velocity is exactly 400.
//
// THE WORLD. An isolated playing run holding the four passives that scale a
// weapon's figures at once, at levels that would move speed the furthest if any
// of them reached it: Glass 5, Oil 5, Wick 5, and Mirror 2. Ember is held alone
// at level 1 with its timer at 0, and three moths stand 300 units out in three
// directions, enough targets for the amount Mirror 2 raises the level-1 row to,
// so every bolt the firing produces is read. Every driver switch is off but weaponFire, so the
// moths hold their distances, the bolts hold the velocity they were launched
// with, and nothing is hit.
//
// WHAT IS READ. The length of every Ember bolt's velocity after the firing
// tick, each exactly 400. How MANY bolts there are is not read: the amount
// Mirror raises is another point's requirement, and this one asks only that
// there is a bolt to read a speed off.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9): the speed is a stated figure spread
// across two components a build forms from a unit vector, which it may
// normalize with Math.hypot or an equivalent.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertWithin } from "../assert";
import {
  EMBER_LEVELS,
  FIGURE_TOLERANCE,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  projectilesOf,
  type Harness,
  type Point,
} from "../harness";
import { armAll, holdPassives, probesAround } from "./night";

/** Every passive that scales a weapon's figures, at a high level. */
const HELD: HeldPassives = { glass: 5, oil: 5, wick: 5, mirror: 2 };

/** The Ember level fired: row 1, speed 400, amount 1. */
const LEVEL = 1;

/** The three targets Ember aims its three bolts at. */
const TARGET = "moth";
const OFFSETS: readonly Point[] = [
  { x: 300, y: 0 },
  { x: -300, y: 0 },
  { x: 0, y: 300 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches every Ember bolt at exactly 400 units per second under four passives", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, TARGET, OFFSETS);
  armAll(h, [["ember", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "speed");

  const bolts = projectilesOf(after, "ember");
  assertGreaterThanOrEqual(
    bolts.length,
    1,
    "Ember bolts after the firing tick, so a speed is there to read",
  );
  for (const bolt of bolts) {
    assertWithin(
      Math.hypot(bolt.vx, bolt.vy),
      EMBER_LEVELS[LEVEL - 1].speed,
      FIGURE_TOLERANCE,
      `bolt ${bolt.id}: the length of its velocity`,
    );
  }
});
