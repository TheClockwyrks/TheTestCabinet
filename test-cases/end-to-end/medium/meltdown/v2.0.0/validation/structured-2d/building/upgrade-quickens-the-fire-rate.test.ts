// Meltdown — building/upgrade-quickens-the-fire-rate — a level multiplies the emitter's
// fire rate by 1.15.
//
// specs/towers.md, Levels: "Each level above the first applies the following to an
// emitter, once per level" — fire rate multiplied by `UPGRADE_FIRE_RATE` (1.15) —
// "so a level III emitter carries ... 1.15^2 times its fire rate".
//
// THE READING IS A SHOT COUNT, because the rate is not in the snapshot.
// `damageDealt` "accumulates the hp each of its shots actually removed"
// (specs/combat.md), and with the heat pinned every shot removes exactly the same
// figure, so the shots a window resolved are that window's damage divided by the
// per-shot damage. Over the window below the three levels are due 40, 46 and 52
// shots — six apart, against a band of one and a half shots either side.
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
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { MAX_LEVEL, TILE, emitterStats } from "../constants";
import {
  captureReplay,
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

/** Where the fire-rate window's target sits: inside every level's range. */
const CLOSE_TILES = 3;

/**
 * How long each fire-rate window runs, in seconds of game time: twenty.
 *
 * THE LENGTH IS WHAT MAKES THE READING DISCRIMINATE, so it stays. The count is
 * whole shots and {@link SHOT_TOLERANCE} is stated in whole shots, so the band is
 * a fixed width however long the window is, while the gap between two levels'
 * expectations grows with it. At this tower's `2.0` shots a second twenty seconds
 * puts consecutive levels six and seven shots apart against a band a shot and a
 * half wide, and nothing between the levels fits; at eight seconds they would be
 * two and a half apart and the bands would overlap, so a build whose multiplier
 * was out by a tenth would pass. What is cut instead is the number of FRAMES the
 * twenty seconds is divided into — see {@link createDriveHarness} — which changes
 * no figure this check reads.
 */
const WINDOW_SECONDS = 20;

/**
 * How far a counted shot tally may sit from `fireRate * WINDOW_SECONDS`, in shots.
 *
 * The fire clock resolves a shot each time its accumulator reaches the interval and
 * carries the remainder (specs/combat.md), so a window that neither opens nor closes
 * on an interval boundary reports the whole shots it covered — within one of the
 * product either way. Half a shot of headroom is added on top, and consecutive
 * levels' expectations are six and seven shots apart over
 * {@link WINDOW_SECONDS}, so no wrong multiplier fits inside the band.
 */
const SHOT_TOLERANCE = 1.5;

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

/**
 * How long the recorded bracket runs, in seconds of game time.
 *
 * Long enough that the level-III cadence — `2.0 * 1.15^2`, a shot every four
 * hundred milliseconds or so — repeats several times over inside it, and short
 * enough that the recording holds every frame it covers rather than being thinned
 * to fit. It backs the picture a reviewer watches and nothing this check asserts.
 */
const REPLAY_SECONDS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("multiplies the fire rate once per level", async () => {
  const def = emitterOf(HELD);

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

    poseProbe(h, CLOSE_TILES);
    const opening = towerOf(h.snapshot(), id);
    assertGreaterThan(
      opening.damage,
      0,
      `${at}: the per-shot damage the shot count below is divided by`,
    );
    await h.advance(driveFrames(WINDOW_SECONDS));
    const closing = towerOf(h.snapshot(), id);
    const shots = (closing.damageDealt - opening.damageDealt) / opening.damage;
    assertBetween(
      shots,
      want.fireRate * WINDOW_SECONDS - SHOT_TOLERANCE,
      want.fireRate * WINDOW_SECONDS + SHOT_TOLERANCE,
      `${at}: the shots resolved over ${WINDOW_SECONDS} s of game time at a ` +
        `fire rate of ${want.fireRate}`,
    );

    // The recording brackets the fastest gun this item is about, and nothing else:
    // a short run of the level-III tower firing at the target the count was made
    // on, armed once the world is already posed and stopped once the cadence has
    // played out several times over.
    if (level === MAX_LEVEL) {
      await captureReplay(h, "rate", async () => {
        await h.advance(driveFrames(REPLAY_SECONDS));
      });
    }
  }
});
