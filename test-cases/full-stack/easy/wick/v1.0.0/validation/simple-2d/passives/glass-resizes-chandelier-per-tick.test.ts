// passives/glass-resizes-chandelier-per-tick — a Chandelier lantern is the
// other exception: its orbit and radius are recomputed from areaMul on every
// tick, so a Glass level resizes the set at once.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "A shape's
// lengths are fixed when it is created, with one exception: the Halo and Corona
// aura's radius and a Chandelier lantern's orbit and radius are recomputed on
// every tick from the level and `areaMul` in force on that tick".
// CHANDELIER_STATS gives orbit 120, radius 20, and amount 4
// (specs/evolutions.md, "Chandelier"), so with nothing held the lanterns read
// radius 20 on an orbit of 120, and with Glass 2 (areaMul 1 + 0.1 × 2 = 1.2)
// they read 24 on 144 on the very next tick. specs/evolutions.md has the set
// created "On the first `playing` tick Chandelier is held", each lantern "on a
// circle of radius `orbit` centered on the player's center", so the orbit is
// read as the distance from the lamplighter's center. specs/instrumentation.md
// ("The driver switches"): "Placement is gated by neither `weaponFire` nor
// `effectMotion`".
//
// THE WORLD. An isolated playing run: nothing on the field, no passive held,
// Chandelier alone, and every driver switch off. Chandelier "has no cooldown
// and no duration", so nothing fires and the set is placed by the placement
// rule alone; effectMotion off holds each lantern at the angle it was created
// on, which neither length reads.
//
// WHAT IS READ. Every lantern's radius and distance from the lamplighter on the
// tick that placed the set, and on the first tick after Glass reached level 2.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each radius and MOTION_TOLERANCE (1e-6)
// on each orbit, which a build forms from a cosine and a sine of the lantern's
// angle.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  CHANDELIER_STATS,
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
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
  type WickSnapshot,
} from "../harness";
import { orbitOf } from "./night";

/** The Glass level gained while the set lives. */
const GLASS = 2;

/** areaMul with nothing held, then with Glass 2 held. */
const BEFORE = derived.areaMul({});
const AFTER = derived.areaMul({ glass: GLASS } satisfies HeldPassives);

/** Read the whole set against `orbit × area` and `radius × area`. */
function assertSet(snapshot: WickSnapshot, area: number, when: string): void {
  const lanterns = zonesOfKind(snapshot, "lantern");
  assertLength(lanterns, CHANDELIER_STATS.amount, `lanterns ${when}`);
  for (const lantern of lanterns) {
    assertWithin(
      lantern.radius,
      CHANDELIER_STATS.radius * area,
      FIGURE_TOLERANCE,
      `lantern ${lantern.id}: radius ${when}`,
    );
    assertWithin(
      orbitOf(snapshot, lantern),
      CHANDELIER_STATS.orbit * area,
      MOTION_TOLERANCE,
      `lantern ${lantern.id}: orbit ${when}`,
    );
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads Chandelier at radius 20 on an orbit of 120, and 24 on 144 after Glass reaches 2", async () => {
  isolate(h);
  holdWeapon(h, "chandelier", 1);

  const placed = await h.tick(1);
  assertSet(placed, BEFORE, "with no Glass held");

  holdPassive(h, "glass", GLASS);
  const resized = await h.tick(1);
  captureStill(h, "resized");

  assertSet(resized, AFTER, "on the tick after Glass reached 2");
});
