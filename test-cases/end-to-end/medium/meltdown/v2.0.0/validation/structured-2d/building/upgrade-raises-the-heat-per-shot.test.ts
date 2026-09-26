// Meltdown — building/upgrade-raises-the-heat-per-shot — a level multiplies the emitter's
// heatPerShot by 1.3.
//
// specs/towers.md, Levels: "Each level above the first applies the following to an
// emitter, once per level" — `heatPerShot` multiplied by `UPGRADE_HEAT` (1.3) —
// "so a level III emitter carries ... 1.3^2 times its heatPerShot".
//
// IT IS MEASURED ON THE ONE FRAME THAT FIRES FROM COLD, and that is why the reading
// needs no arithmetic at all. specs/heat.md resolves a frame as
// `dH = (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) / mass` with
// "every term computed from the heats the frame opened with", and `airLoss` is
// proportional to that opening heat. So on a tower posed at heat 0, alone on the
// floor, every term but `shotGain` is exactly zero, and the frame on which its
// first shot lands leaves the heat at `heatPerShot / mass` — nothing subtracted,
// nothing to predict. The frames before it leave the heat at 0 for the same reason,
// so stepping one frame at a time and stopping on the first shot reads it exactly,
// at any frame length.
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
import { assertBetween, assertEqual, fail } from "../assert";
import { MAX_LEVEL, TILE, emitterStats } from "../constants";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  footprintCenter,
  poseTargetAt,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { emitterOf, towerOf } from "./preview";
import { FREE_SITE } from "./sites";

/** The tower upgraded, on a quiet anchor with nothing within six tiles. */
const HELD = "arc";
const AT = FREE_SITE;

/** The three levels, in the order the upgrades reach them. */
const LEVELS = [1, 2, 3];

/** Far above both upgrade costs, so affordability never refuses a step. */
const PURSE = 1000;

/** Where the fire-rate window's target sits: inside every level's range. */
const CLOSE_TILES = 3;

/**
 * How much heat one shot from cold may miss its figure by.
 *
 * Both sides are exact — every term of that frame but `shotGain` is zero — so this
 * is float noise again. The gap between consecutive levels' figures on this tower is
 * over three whole points of heat, so the band is two orders of magnitude below the
 * smallest distinction it has to make.
 *
 * AND IT IS EXACT AT ANY FRAME LENGTH, which is what lets this check run on the
 * coarser drive clock. `specs/heat.md` computes every loss term from the heat
 * the frame OPENED with and scales it by the frame's `dt`; the tower is pinned to
 * a heat of zero before the shot is waited for, so every one of those terms is
 * zero times `dt` and the reading is `heatPerShot` over the mass whether a frame
 * is a thirtieth of a second or a hundred and twentieth.
 */
const HEAT_TOLERANCE = 0.02;

/**
 * How many frames the first shot from cold is waited for.
 *
 * specs/combat.md lands the first shot one full interval after the target was
 * acquired, which at this tower's slowest level is half a second; at this check's
 * long-drive clock of thirty frames a second (`harness.ts`, The long-drive clock)
 * that is fifteen frames, and this is twice a whole second of them.
 */
const SHOT_FRAMES = driveFrames(1);

/** The tower's footprint centre, which specs/combat.md measures range from. */
const CENTRE = footprintCenter(HELD, AT.col, AT.row);

/** Far past anything a window below can remove, so no death interrupts a count. */
const TARGET_HP = 1e6;

/**
 * Put one stationary, effectively unkillable target `tiles` tiles due east of the
 * tower's footprint centre, and hand back its id.
 *
 * Due east so the distance is the one thing that varies between probes, and
 * stationary so it cannot walk across a range boundary while a reading is taken. The
 * surge is emptied first, so exactly one unit is ever on the floor and `targeting`
 * names it unambiguously.
 */
function poseProbe(h: Harness, tiles: number): number {
  h.debug.clearSurge();
  return poseTargetAt(h, "mote", CENTRE.x + tiles * TILE, CENTRE.y, TARGET_HP);
}

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("multiplies the heat each shot adds, once per level", async () => {
  const def = emitterOf(HELD);

  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, AT.col, AT.row);

  for (const level of LEVELS) {
    if (level > 1) h.debug.upgradeTower(id);
    const at = `level ${level}`;
    const want = emitterStats(def, level);

    const tower = towerOf(h.snapshot(), id);
    assertEqual(tower.level, level, `the level after ${level - 1} upgrade(s)`);

    h.debug.setTowerThermal(id, true);
    h.debug.setTowerHeat(id, 0);
    poseProbe(h, CLOSE_TILES);
    const cold = towerOf(h.snapshot(), id);
    let afterOneShot: number | null = null;
    for (
      let frame = 0;
      frame < SHOT_FRAMES && afterOneShot === null;
      frame += 1
    ) {
      await h.advance(1);
      const now = towerOf(h.snapshot(), id);
      if (now.damageDealt > cold.damageDealt) afterOneShot = now.heat;
    }
    if (afterOneShot === null) {
      fail(
        `${at}: a shot within ${SHOT_FRAMES} frames of a target ${CLOSE_TILES} ` +
          "tiles out, which the heat reading is taken on (specs/combat.md)",
        "no shot resolved",
      );
    }
    const wantHeat = want.heatPerShot / def.mass;
    assertBetween(
      afterOneShot,
      wantHeat - HEAT_TOLERANCE,
      wantHeat + HEAT_TOLERANCE,
      `${at}: the heat one shot from cold left, a heatPerShot of ` +
        `${want.heatPerShot} over a mass of ${def.mass}`,
    );

    if (level === MAX_LEVEL) captureStill(h, "heat");
  }
});
