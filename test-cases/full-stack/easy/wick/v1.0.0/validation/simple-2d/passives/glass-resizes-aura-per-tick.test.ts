// passives/glass-resizes-aura-per-tick — the aura is the exception: its radius
// is recomputed from areaMul on every tick, so a Glass level resizes it at once.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "A shape's
// lengths are fixed when it is created, with one exception: the Halo and Corona
// aura's radius and a Chandelier lantern's orbit and radius are recomputed on
// every tick from the level and `areaMul` in force on that tick". Row 1 of
// HALO_LEVELS gives radius 80 (specs/weapons.md, "Halo"), so with nothing held
// the aura reads 80 × 1 = 80, and with Glass 2 (areaMul 1 + 0.1 × 2 = 1.2) it
// reads 96 on the very next tick. specs/world.md ("One tick"), phase 5, has the
// placement run "on every `playing` tick", and specs/instrumentation.md ("The
// driver switches") states "Placement is gated by neither `weaponFire` nor
// `effectMotion`".
//
// THE WORLD. An isolated playing run: nothing on the field, no passive held,
// Halo alone at level 1, and every driver switch off, weaponFire included. The
// aura is placed by the placement rule alone, so nothing pulses, nothing fires,
// and the only zone in the world is the one under test.
//
// WHAT IS READ. The aura's radius on the tick that placed it, 80, and on the
// first tick after Glass reached level 2, 96. Both are read: a build that
// recomputes only when the aura is created passes the first and misses the
// second, and a build whose table radius is wrong misses the first.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each, a product of two stated figures
// read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  HALO_LEVELS,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

/** The Halo level held: row 1, radius 80. */
const LEVEL = 1;

/** The Glass level gained while the aura lives. */
const GLASS = 2;

/** 80 × 1, the radius with nothing held. */
const BEFORE = HALO_LEVELS[LEVEL - 1].radius * derived.areaMul({});

/** 80 × 1.2 = 96, the radius one tick after Glass 2 is held. */
const AFTER =
  HALO_LEVELS[LEVEL - 1].radius *
  derived.areaMul({ glass: GLASS } satisfies HeldPassives);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the level-1 aura at radius 80, and at 96 on the tick after Glass reaches 2", async () => {
  isolate(h);
  holdWeapon(h, "halo", LEVEL);

  const placed = await h.tick(1);
  const first = zonesOfKind(placed, "aura");
  assertLength(first, 1, "auras after the placing tick");
  assertWithin(
    first[0].radius,
    BEFORE,
    FIGURE_TOLERANCE,
    "the aura's radius with no Glass held",
  );

  holdPassive(h, "glass", GLASS);
  const resized = await h.tick(1);
  captureStill(h, "resized");

  const second = zonesOfKind(resized, "aura");
  assertLength(second, 1, "auras after the Glass level");
  assertWithin(
    second[0].radius,
    AFTER,
    FIGURE_TOLERANCE,
    "the aura's radius on the tick after Glass reached 2",
  );
});
