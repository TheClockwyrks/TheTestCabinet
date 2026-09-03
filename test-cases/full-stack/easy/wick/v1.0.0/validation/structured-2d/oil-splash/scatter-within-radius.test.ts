// oil-splash/scatter-within-radius — every puddle lands within OIL_SCATTER of
// the lamplighter's center.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "On
// firing, `amount` puddles appear, each centered at an independent uniformly
// random point of the disk of radius `OIL_SCATTER` (`400`) about the player's
// center: a distance `OIL_SCATTER × sqrt(u)` at a uniformly random angle, with
// `u` uniform on `[0, 1)`." So a puddle's center is at most 400 from the
// player's center on the tick it lands, whatever the draw. ("Derived stats"):
// "`OIL_SCATTER` ... [is] unchanged by any passive."
//
// WHY THE DISTANCE IS READ ON THE FIRING TICK. `specs/world.md` ("One tick"),
// phase 5 creates a firing's zones "at the lamplighter's ... positions of
// this tick", and a puddle "stays where it landed" (`specs/weapons.md`), so
// the snapshot after the firing tick holds each puddle at its landing point,
// and the lamplighter, holding no key, at the center the check posed.
//
// WHY TWENTY FIRINGS AT TWENTY CENTERS. A single draw says little about a
// disk; twenty firings at level 8, four puddles each, sample it eighty times
// from one seeded generator. Before each firing the lamplighter is posed at a
// fresh center well over 400 from the origin and from every other center, so
// a build that scattered about the origin, or about where the run began,
// lands its puddles outside the disk about the center of the tick and fails.
// The re-firings come through `setWeaponCooldown(slot, 0)` rather than the
// cooldown running out, which is the cooldown checks' point.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, Oil Splash at level 8 armed, `weaponFire` on and every other switch
// off. That level 8 creates four puddles a firing is `row-8`'s point; here
// the count is only required to be positive, so the disk is sampled at all.
//
// THE TOLERANCE. `REAL_EPS` above `OIL_SCATTER`: the distance is the length
// of a two-component offset, two products and a square root; a puddle scattered
// about the wrong center or over a wider disk is off by whole units.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { OIL_SCATTER, REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  type Harness,
} from "../harness";
import { fireAgain, fireOilSplash } from "./firing";

/** Level 8 of Oil Splash: amount 4, the most puddles a firing produces. */
const LEVEL = 8;

/** How many firings sample the disk. */
const FIRINGS = 20;

/**
 * The lamplighter's center before firing `i`: a fresh point each time, every
 * one over 400 from the origin and from every other, so the disk is measured
 * about the center of the tick and nothing else.
 */
function centerOf(i: number): { x: number; y: number } {
  return { x: 900 * (i + 1), y: -500 * (i + 1) };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands every puddle of twenty firings at most OIL_SCATTER from the lamplighter's center on its firing tick", async () => {
  let sampled = 0;
  let farthest = 0;
  let slot = -1;
  for (let i = 0; i < FIRINGS; i += 1) {
    const center = centerOf(i);
    let firing;
    if (i === 0) {
      firing = await fireOilSplash(h, LEVEL, undefined, center);
      slot = firing.slot;
    } else {
      h.debug.setPlayerPosition(center.x, center.y);
      firing = await fireAgain(h, slot);
    }
    const { player } = firing.after.run;
    for (const puddle of firing.puddles) {
      const reach = distance(puddle, player);
      sampled += 1;
      farthest = Math.max(farthest, reach);
      assertLessThanOrEqual(
        reach,
        OIL_SCATTER + REAL_EPS,
        `firing ${i + 1}, puddle ${puddle.id}: distance from the lamplighter's center on its firing tick (specs/weapons.md, Oil Splash)`,
      );
    }
  }
  captureStill(h, "scatter");

  assertGreaterThan(
    sampled,
    0,
    `puddles created across ${FIRINGS} firings, the sample the disk is measured on (farthest ${farthest})`,
  );
});
