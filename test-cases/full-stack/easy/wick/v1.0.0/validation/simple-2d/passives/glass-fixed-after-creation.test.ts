// passives/glass-fixed-after-creation — a Glass level gained after a shape was
// created leaves that shape's lengths as they were.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "A shape's
// lengths are fixed when it is created, with one exception: the Halo and Corona
// aura's radius and a Chandelier lantern's orbit and radius are recomputed on
// every tick". A puddle, a bolt, and a Lantern set are none of the exceptions,
// so each keeps the lengths the tick that created it gave it. With no Glass
// held areaMul is 1 (specs/passives.md, "Holding a passive": "a passive not
// held is level 0, so every multiplier starts at 1"), so row 1 of
// OIL_SPLASH_LEVELS gives radius 50, row 1 of EMBER_LEVELS radius 8, and row 1
// of LANTERN_LEVELS radius 14 on an orbit of 90 (specs/weapons.md), and each of
// the four figures is what the shapes still read after Glass reaches level 2.
//
// THE WORLD. An isolated playing run with no passive held: Oil Splash, Ember,
// and Lantern at level 1 with their timers at 0, and one moth 1000 units along
// +x, the target "Ember needs at least one enemy to fire" requires. Every
// driver switch is off but weaponFire, so nothing moves and nothing is reached:
// the moth stands beyond OIL_SCATTER (400), the disk a puddle can land in, and
// beyond the 90 units a lantern rides at. The three cooldowns are 3.0, 1.20, and
// 3.0 + 3.0 seconds, all far past the one tick that follows the Glass pose, so
// no shape is replaced by a fresh firing.
//
// WHAT IS READ. The puddle's radius, the bolt's radius, and the lantern's
// radius and distance from the lamplighter, one tick after Glass was placed at
// level 2, each still the unscaled figure. The Glass level is read back from
// the snapshot first, so a build that never took the pose fails on that rather
// than passing by standing still.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each radius, a stated figure read back
// as a double, and MOTION_TOLERANCE (1e-6) on the orbit, which a build forms
// from a cosine and a sine of the lantern's angle.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  EMBER_LEVELS,
  FIGURE_TOLERANCE,
  LANTERN_LEVELS,
  MOTION_TOLERANCE,
  OIL_SPLASH_LEVELS,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  passiveSlot,
  projectilesOf,
  zonesOf,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armAll, holdPassives, orbitOf, probesAround } from "./night";

/** What is held while the shapes are created: nothing. */
const BEFORE: HeldPassives = {};

/** The Glass level gained after they exist. */
const AFTER_LEVEL = 2;

/** The level each weapon is held at: row 1 of each table. */
const LEVEL = 1;

/** areaMul with no Glass held: 1. */
const AREA = derived.areaMul(BEFORE);

/** The target Ember needs, held 1000 units out and never reached. */
const TARGET = "moth";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a live puddle, bolt, and Lantern set at their unscaled lengths when Glass reaches 2", async () => {
  isolate(h);
  holdPassives(h, BEFORE);
  probesAround(h, TARGET, [{ x: 1000, y: 0 }]);
  armAll(h, [
    ["oil-splash", LEVEL],
    ["ember", LEVEL],
    ["lantern", LEVEL],
  ]);

  const fired = await h.tick(1);
  assertLength(zonesOf(fired, "oil-splash"), 1, "puddles created");
  assertLength(projectilesOf(fired, "ember"), 1, "bolts created");
  assertLength(zonesOfKind(fired, "lantern"), 1, "lanterns created");

  holdPassive(h, "glass", AFTER_LEVEL);
  const after = await h.tick(1);
  captureStill(h, "fixed");

  const slot = passiveSlot(after, "glass");
  assertEqual(
    after.run.passives[slot]?.level,
    AFTER_LEVEL,
    "the Glass level held while the shapes live",
  );

  const puddles = zonesOf(after, "oil-splash");
  const bolts = projectilesOf(after, "ember");
  const lanterns = zonesOfKind(after, "lantern");
  assertLength(puddles, 1, "puddles still alive");
  assertLength(bolts, 1, "bolts still alive");
  assertLength(lanterns, 1, "lanterns still alive");
  assertWithin(
    puddles[0].radius,
    OIL_SPLASH_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the live puddle's radius after Glass reached 2",
  );
  assertWithin(
    bolts[0].radius,
    EMBER_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the live bolt's radius after Glass reached 2",
  );
  assertWithin(
    lanterns[0].radius,
    LANTERN_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the live lantern's radius after Glass reached 2",
  );
  assertWithin(
    orbitOf(after, lanterns[0]),
    LANTERN_LEVELS[LEVEL - 1].orbit * AREA,
    MOTION_TOLERANCE,
    "the live lantern's orbit after Glass reached 2",
  );
});
