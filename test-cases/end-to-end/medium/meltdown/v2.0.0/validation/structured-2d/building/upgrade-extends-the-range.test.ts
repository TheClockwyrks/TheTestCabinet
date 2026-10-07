// Meltdown — building/upgrade-extends-the-range — a level adds 1.0 tile to the emitter's
// range.
//
// specs/towers.md, Levels: "Each level above the first applies the following to an
// emitter, once per level" — range with `UPGRADE_RANGE` (1.0) tile added — "so a
// level III emitter carries ... 2.0 tiles more range".
//
// THE READING IS WHAT THE TOWER WILL TARGET, because the range is not in the
// snapshot. specs/combat.md: "A surge unit is in range when the distance from that
// centre to the unit's centre is at most `range * TILE` logical units", and
// `targeting` reports "the id of the unit it is firing on". The Arc reaches 6.0,
// 7.0 and 8.0 tiles at its three levels, so a target at 6.5 tiles is out of reach at
// level I and inside it at II and III, and one at 7.5 is out at I and II and inside
// at III. That pair of probes pins "+1.0 per level" exactly: a build that adds
// nothing reads both probes out at every level, one that adds 2.0 reads the far
// probe in at level II, and one that MULTIPLIES the range instead of adding to it
// reads 6.5 in at level II (x1.15 gives 6.9) but never reaches 7.5 by level II —
// every wrong model lands on a different row of the table.
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
import { assertEqual, assertNull } from "../assert";
import { MAX_LEVEL, TILE, emitterStats } from "../constants";
import {
  captureStill,
  createDriveHarness,
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

/** Where the two range probes sit, in tiles, against a level-I range of 6.0. */
const NEAR_TILES = 6.5;
const FAR_TILES = 7.5;

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

it("adds a tile of range once per level", async () => {
  const def = emitterOf(HELD);

  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, AT.col, AT.row);

  for (const level of LEVELS) {
    if (level > 1) h.debug.upgradeTower(id);
    const at = `level ${level}`;
    const want = emitterStats(def, level);

    // The thermal model is held off: the requirement is what the tower can
    // REACH, and a tower that heated itself while the probes were read could
    // trip and report no target for a reason that is not its range
    // (specs/instrumentation.md, the thermal gate).
    h.debug.setTowerThermal(id, false);
    h.debug.setTowerHeat(id, 0);

    const tower = towerOf(h.snapshot(), id);
    assertEqual(tower.level, level, `the level after ${level - 1} upgrade(s)`);

    for (const tiles of [NEAR_TILES, FAR_TILES]) {
      const unit = poseProbe(h, tiles);
      await h.advance(1);
      const probed = towerOf(h.snapshot(), id);
      const reach = `${at}: a target ${tiles} tiles out, against a range of ${want.range}`;
      if (tiles <= want.range) {
        assertEqual(probed.targeting, unit, `${reach} — it is in reach`);
      } else {
        assertNull(probed.targeting, `${reach} — it is out of reach`);
      }
    }

    if (level === MAX_LEVEL) {
      // Selected, so the ring the widened range is drawn at is in the picture.
      h.debug.setSelected(id);
      await h.advance(1);
      captureStill(h, "ring");
      h.debug.setSelected(null);
    }
  }
});
