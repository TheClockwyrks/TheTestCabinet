// building/upgrade-leaves-the-geometry — an upgrade moves four figures and leaves
// the rest of the tower exactly as it was.
//
// specs/towers.md, Levels: "A level leaves the footprint's size, the redline, the
// mass, and the radiator face layout exactly as they were." The four figures a
// level DOES move are `building/upgrade-changes-the-stats`' business; this item is
// the four it must not.
//
// THREE OF THE FOUR ARE READ STRAIGHT OFF THE SNAPSHOT — `size`, `redline` and
// `radiatorFaces` are all reported there. THE MASS IS NOT, and it cannot be: the
// snapshot carries no mass, because mass is not something a player reads. So it is
// measured where the specification says it acts, which is on the heat:
// specs/heat.md, "Each emitter has a thermal mass `mass` that divides every change
// to its heat", and a frame's change for an idle, isolated emitter is
//
//   dH = -airLoss * dt / mass,  airLoss = (RAD_K * radiatorEdges + BASE_K * plainEdges) * H / 100
//
// EVERY TERM OF THAT EXPRESSION IS GEOMETRY. `mass` is the divisor, and
// `radiatorEdges` and `plainEdges` are the radiator layout counted around a
// footprint of side `size`. So ONE reading — the heat a fixed window removes,
// starting from the same posed heat — measures all four of the figures this item is
// about at once, and it does so without asserting any rate: the two readings are
// compared against EACH OTHER, so what the air-cooling rate actually is stays
// `heat/air-cooling-rate`'s business.
//
// AND IT IS NOT A VACUOUS COMPARISON. A build that never cools at all would report
// the same drop twice and pass on a technicality, so the level-I drop is required
// to be a real one first.
//
// THE TOWER IS POSED IDLE AND ALONE. `poseIdleTower` holds its guns
// (specs/instrumentation.md: firing off leaves the thermal model running exactly as
// an idle tower's does), so no shot can add heat under the reading — which matters
// especially here, because `heatPerShot` is one of the figures a level DOES move.
// The anchor is a quiet one with nothing within six tiles, so no conduction, no
// Forge and no Sink is in the sum, and no unit is on the floor to be fired at.
//
// THE LEVEL IS REACHED BY PAYING FOR TWO REAL UPGRADES, because the requirement is
// about what UPGRADING leaves alone rather than about what a level-III tower
// happens to report.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_LEVEL } from "../constants";
import {
  assertBetween,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import {
  TICK_HZ,
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Harness,
} from "../harness";
import { towerOf } from "./preview";
import { FREE_SITE } from "./sites";

/** The tower upgraded, on a quiet anchor with nothing within six tiles. */
const HELD = "arc";
const AT = FREE_SITE;

/** Far above both upgrade costs, so affordability never refuses a step. */
const PURSE = 1000;

/**
 * The heat each cooling window opens at.
 *
 * High enough that a second of air cooling removes a figure many times any
 * tolerance below, and below `TRIP_HEAT` so nothing here can trip.
 */
const PROBE_HEAT = 80;

/** How long each cooling window runs, in frames: one second at the harness's rate. */
const WINDOW_FRAMES = TICK_HZ;

/**
 * How much heat the level-I window must remove for the comparison to mean
 * anything.
 *
 * Not a rate: a floor under "the tower cooled at all", well below what the
 * specification's own figures give this tower over a second, so a build whose
 * cooling is merely slower than the reference still clears it and is graded on the
 * comparison this item is actually about.
 */
const MIN_DROP = 1;

/**
 * How close the level-I and level-III drops must be, in heat.
 *
 * They are the same computation over the same edges and the same mass, so any
 * difference is float noise. For scale: if an upgrade multiplied the mass by any of
 * the four figures a level does move — 1.15 at the smallest — the level-III drop
 * would land whole points away, so this band is two orders of magnitude below the
 * smallest change it exists to catch.
 */
const DROP_TOLERANCE = 0.05;

/** Cool the tower from {@link PROBE_HEAT} for one window and hand back the drop. */
async function coolingDrop(h: Harness, id: number): Promise<number> {
  h.debug.setTowerHeat(id, PROBE_HEAT);
  await h.advance(WINDOW_FRAMES);
  return PROBE_HEAT - towerOf(h.snapshot(), id).heat;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the size, the redline, the radiator layout and the mass where they were", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseIdleTower(h, HELD, AT.col, AT.row);

  const first = towerOf(h.snapshot(), id);
  const dropAtOne = await coolingDrop(h, id);
  captureStill(h, "geometry");

  h.debug.upgradeTower(id);
  h.debug.upgradeTower(id);
  const last = towerOf(h.snapshot(), id);
  const dropAtThree = await coolingDrop(h, id);

  assertEqual(
    last.level,
    MAX_LEVEL,
    `the level two paid upgrades left the ${HELD} at`,
  );

  assertEqual(last.size, first.size, "the footprint's side after two upgrades");
  assertEqual(last.redline, first.redline, "the redline after two upgrades");
  assertDeepEqual(
    [...last.radiatorFaces].sort(),
    [...first.radiatorFaces].sort(),
    "the world radiator faces after two upgrades",
  );

  assertGreaterThan(
    dropAtOne,
    MIN_DROP,
    `the heat a level-I ${HELD} shed from ${PROBE_HEAT} over ` +
      `${WINDOW_FRAMES} frames, which the comparison below rests on being real`,
  );
  assertBetween(
    dropAtThree,
    dropAtOne - DROP_TOLERANCE,
    dropAtOne + DROP_TOLERANCE,
    `the heat the same ${HELD} shed from ${PROBE_HEAT} over the same window at ` +
      `level ${MAX_LEVEL}, against the ${dropAtOne} it shed at level I — which ` +
      "the mass and the radiator layout alone decide",
  );
});
