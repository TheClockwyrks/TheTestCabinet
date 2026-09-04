// building/upgrade-raises-the-damage — a level multiplies the emitter's base
// damage by 1.6.
//
// specs/towers.md, Levels: "Each level above the first applies the following to an
// emitter, once per level" — base damage multiplied by `UPGRADE_DAMAGE` (1.6) —
// "so a level III emitter carries 1.6^2 times its base damage".
//
// THE READING IS DIRECT. `damage` is "the per-shot damage specs/combat.md states"
// (specs/instrumentation.md), which is `baseDamage(level) * heatMultiplier(H,
// redline)`; the redline is unchanged by level, so with the heat PINNED the whole
// per-level change in that figure is the base-damage multiple.
//
// THE TOWER IS AN ARC, and the choice does work. Its mass is 1.0, so the heat one
// shot leaves is `heatPerShot` itself rather than a quotient; its range is a whole
// number of tiles at every level, so a probe sits half a tile off a boundary rather
// than near one; and its redline of 80 is above the pinned heat, so the damage
// multiplier is on the curve rather than on its plateau.
//
// EVERY LEVEL IS REACHED BY PAYING FOR A REAL UPGRADE, because the requirement is
// what an UPGRADE does. The purse is far above both costs, so affordability is never
// what refuses one, and the level is read back at each step so a build that failed
// to upgrade at all is named for that rather than for its stats.
//
// THE FLOOR HOLDS THE TOWER AND AT MOST ONE TARGET AND NOTHING ELSE. The anchor is a
// quiet one with nothing within six tiles, so no conduction, no Forge and no Sink is
// in any heat sum; a target's motion is held, so it cannot walk across a boundary
// while a reading is taken; and its hp is far past anything a window can remove, so
// no death interrupts a count.
//
// THE OTHER THREE ROWS OF THAT TABLE ARE THEIR OWN POINTS. Each is independently
// breakable — a build that scales the damage and forgets the range has missed one
// requirement, not four — so `building.upgrade-raises-the-damage`,
// `building.upgrade-extends-the-range`, `building.upgrade-quickens-the-fire-rate`
// and `building.upgrade-raises-the-heat-per-shot` grade one row each.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { MAX_LEVEL, emitterStats, heatMultiplier } from "../constants";
import {
  captureStill,
  createDriveHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { emitterOf } from "./preview";
import { FREE_SITE } from "./sites";

/** The tower upgraded, on a quiet anchor with nothing within six tiles. */
const HELD = "arc";
const AT = FREE_SITE;

/** The three levels, in the order the upgrades reach them. */
const LEVELS = [1, 2, 3];

/** Far above both upgrade costs, so affordability never refuses a step. */
const PURSE = 1000;

/**
 * The heat the tower is pinned at for the damage and fire-rate readings.
 *
 * Well clear of both ends of the curve, so `heatMultiplier` is on the quadratic
 * rather than at its floor or its plateau, and far below `TRIP_HEAT` so nothing can
 * trip while a window is counted. Pinning is what makes both readings measurements
 * of one figure: the thermal gate holds the tower's part in the heat model while it
 * goes on firing at that heat (specs/instrumentation.md), so the multiplier that
 * scales every shot is the same one at the start of a window and at its end.
 */
const PIN_HEAT = 40;

/**
 * How close a damage reading must sit to the figure the specification gives it.
 *
 * The figure is exact arithmetic on both sides, so this band exists for float noise
 * alone: for scale, one level of the 1.6 multiplier moves this tower's per-shot
 * damage by more than four whole points.
 */
const DAMAGE_TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("multiplies the base damage once per level", async () => {
  const def = emitterOf(HELD);
  const pinMult = heatMultiplier(PIN_HEAT, def.redline);

  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, AT.col, AT.row);

  for (const level of LEVELS) {
    if (level > 1) h.debug.upgradeTower(id);
    const at = `level ${level}`;
    const want = emitterStats(def, level);

    // The heat is pinned before anything is read, so no reading below is taken
    // while the figure that scales it moves underneath.
    h.debug.setTowerThermal(id, false);
    h.debug.setTowerHeat(id, PIN_HEAT);

    const tower = towerOf(h.snapshot(), id);
    assertEqual(tower.level, level, `the level after ${level - 1} upgrade(s)`);

    assertBetween(
      tower.damage,
      want.baseDamage * pinMult - DAMAGE_TOLERANCE,
      want.baseDamage * pinMult + DAMAGE_TOLERANCE,
      `${at}: the per-shot damage at heat ${PIN_HEAT}, a base damage of ` +
        `${want.baseDamage} scaled by the multiplier ${pinMult}`,
    );

    if (level === LEVELS[0]) captureStill(h, "before");
    if (level === MAX_LEVEL) captureStill(h, "after");
  }
});
