// building/upgrade-changes-the-stats — a level runs the tower stronger and hotter,
// by the four multiples specs/towers.md fixes.
//
// specs/towers.md, Levels: "Each level above the first applies the following to an
// emitter, once per level" — base damage multiplied by `UPGRADE_DAMAGE` (1.6),
// range with `UPGRADE_RANGE` (1.0) tile added, fire rate multiplied by
// `UPGRADE_FIRE_RATE` (1.15), `heatPerShot` multiplied by `UPGRADE_HEAT` (1.3) —
// "so a level III emitter carries 1.6^2 times its base damage, 2.0 tiles more
// range, 1.15^2 times its fire rate, and 1.3^2 times its heatPerShot."
//
// FOUR FIGURES, THREE LEVELS, ONE ITEM. The requirement is the per-level scaling,
// and a build that scales the damage but not the range has not met it, so all four
// are read. Only ONE of the four is in the snapshot; the other three are measured
// where the specification says they act, and each reading is arranged so nothing
// but the figure under test can move it.
//
//   DAMAGE is read directly. `damage` is the per-shot damage specs/combat.md
//   states, which is `baseDamage(level) * heatMultiplier(H, redline)`; the redline
//   is unchanged by level, so with the heat PINNED the whole per-level change in
//   that figure is the base-damage multiple.
//
//   RANGE is measured by what the tower will target. specs/combat.md: "A surge unit
//   is in range when the distance from that centre to the unit's centre is at most
//   range * TILE logical units", and `targeting` reports the id of the unit it is
//   firing on. The Arc reaches 6.0, 7.0 and 8.0 tiles at its three levels, so a
//   target at 6.5 tiles is out of reach at level I and inside it at II and III, and
//   one at 7.5 is out at I and II and inside at III. That pair of probes pins
//   "+1.0 per level" exactly: a build that adds nothing reads both probes out at
//   every level, one that adds 2.0 reads the far probe in at level II, and one that
//   MULTIPLIES the range instead of adding to it reads 6.5 in at level II (x1.15
//   gives 6.9) but not 7.5 — every wrong model lands on a different row of the
//   table below.
//
//   FIRE RATE is measured by counting shots. `damageDealt` accumulates the hp each
//   of its shots actually removed (specs/combat.md), and with the heat pinned every
//   shot removes exactly the same figure, so the shots a window resolved are that
//   window's damage divided by the per-shot damage. Over the window below the three
//   levels are due 40, 46 and 52 shots — six apart, against a band of one and a half
//   shots either side.
//
//   heatPerShot IS MEASURED ON THE ONE FRAME THAT FIRES FROM COLD, and that is why
//   the reading needs no arithmetic at all. specs/heat.md resolves a frame as
//   `dH = (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) / mass` with
//   every term computed from the heats the frame opened with, and `airLoss` is
//   proportional to that opening heat. So on a tower posed at heat 0, alone on the
//   floor, every term but `shotGain` is exactly zero, and the frame on which its
//   first shot lands leaves the heat at `heatPerShot / mass` — nothing subtracted,
//   nothing to predict. The frames before it leave the heat at 0 for the same
//   reason, so stepping one frame at a time and stopping on the first shot reads it
//   exactly, at any frame length.
//
// THE TOWER IS AN ARC, and the choice does work. Its mass is 1.0, so the heat
// reading is `heatPerShot` itself rather than a quotient; its range is a whole
// number of tiles at every level, so the two probes sit half a tile off a boundary
// rather than near one; and its redline of 80 is above the pinned heat, so the
// damage multiplier is on the curve rather than on its plateau.
//
// EVERY LEVEL IS REACHED BY PAYING FOR A REAL UPGRADE, because the requirement is
// what an UPGRADE does. The purse is far above both costs, so affordability is never
// what refuses one, and the level is read back at each step so a build that failed
// to upgrade at all is named for that rather than for its stats.
//
// THE FLOOR HOLDS THE TOWER AND ONE TARGET AND NOTHING ELSE. The anchor is a quiet
// one with nothing within six tiles, so no conduction, no Forge and no Sink is in
// any heat sum; the target's motion is held, so it cannot walk out of range while a
// window is being counted; and its hp is far past anything the window can remove,
// so no death interrupts the count.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_LEVEL, TILE, emitterStats, heatMultiplier } from "../constants";
import {
  assertBetween,
  assertEqual,
  assertGreaterThan,
  assertNull,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  footprintCenter,
  poseTargetAt,
  poseTower,
  startRun,
  ticksFor,
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

/** Where the two range probes sit, in tiles, against a level-I range of 6.0. */
const NEAR_TILES = 6.5;
const FAR_TILES = 7.5;

/** Where the fire-rate window's target sits: inside every level's range. */
const CLOSE_TILES = 3;

/** How long each fire-rate window runs, in seconds of game time. */
const WINDOW_SECONDS = 20;

/**
 * How far a counted shot tally may sit from `fireRate * WINDOW_SECONDS`, in shots.
 *
 * The fire clock resolves a shot each time its accumulator reaches the interval and
 * carries the remainder (specs/combat.md), so a window that neither opens nor closes
 * on an interval boundary reports the whole shots it covered — within one of the
 * product either way. Half a shot of headroom is added on top, and the three levels'
 * expectations are six shots apart, so no wrong multiplier fits inside the band.
 */
const SHOT_TOLERANCE = 1.5;

/**
 * How much heat one shot from cold may miss its figure by.
 *
 * Both sides are exact — every term of that frame but `shotGain` is zero — so this
 * is float noise again. The gap between consecutive levels' figures on this tower is
 * over three whole points of heat, so the band is two orders of magnitude below the
 * smallest distinction it has to make.
 */
const HEAT_TOLERANCE = 0.02;

/**
 * How many frames the first shot from cold is waited for.
 *
 * specs/combat.md lands the first shot one full interval after the target was
 * acquired, which at this tower's slowest level is half a second; at the harness's
 * 120 frames a second that is sixty frames, and this is twice that.
 */
const SHOT_FRAMES = 120;

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
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("multiplies the damage, the fire rate and the heat per shot and adds to the range, once per level", async () => {
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

    /* ---- Base damage: multiplied by 1.6 per level ----------------------- */

    assertBetween(
      tower.damage,
      want.baseDamage * pinMult - DAMAGE_TOLERANCE,
      want.baseDamage * pinMult + DAMAGE_TOLERANCE,
      `${at}: the per-shot damage at heat ${PIN_HEAT}, a base damage of ` +
        `${want.baseDamage} scaled by the multiplier ${pinMult}`,
    );

    /* ---- Range: 1.0 tile added per level -------------------------------- */

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

    /* ---- Fire rate: multiplied by 1.15 per level ------------------------ */

    poseProbe(h, CLOSE_TILES);
    const opening = towerOf(h.snapshot(), id);
    assertGreaterThan(
      opening.damage,
      0,
      `${at}: the per-shot damage the shot count below is divided by`,
    );
    await h.advance(ticksFor(WINDOW_SECONDS));
    const closing = towerOf(h.snapshot(), id);
    const shots = (closing.damageDealt - opening.damageDealt) / opening.damage;
    assertBetween(
      shots,
      want.fireRate * WINDOW_SECONDS - SHOT_TOLERANCE,
      want.fireRate * WINDOW_SECONDS + SHOT_TOLERANCE,
      `${at}: the shots resolved over ${WINDOW_SECONDS} s of game time at a ` +
        `fire rate of ${want.fireRate}`,
    );

    /* ---- heatPerShot: multiplied by 1.3 per level ----------------------- */

    h.debug.setTowerThermal(id, true);
    h.debug.setTowerHeat(id, 0);
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

    if (level === 1) captureStill(h, "before");
    if (level === MAX_LEVEL) captureStill(h, "after");
  }
});
