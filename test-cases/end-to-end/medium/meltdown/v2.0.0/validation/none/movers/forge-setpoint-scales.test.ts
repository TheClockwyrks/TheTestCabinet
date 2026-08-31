// Meltdown — movers/forge-setpoint-scales: the setpoint rises with the level.
//
// `specs/towers.md` tabulates the Forge's `FORGE_SETPOINT` at `72`, `84` and `96`
// for levels I, II and III, and says a mover's level "moves its own output
// alone". `specs/heat.md` puts that setpoint inside the flow —
// `FORGE_K * sharedEdges * max(0, setpoint(F) - H_T)` — so the level shows up
// twice, and this point reads it both times.
//
// FIRST, THE TABLE. Three Arcs, one per Forge level, all posed at the same `60`
// and read in the same frame, so the only thing that differs between the three
// readings is the level. The flows are `0.9 * 2 * 12`, `0.9 * 2 * 24` and
// `0.9 * 2 * 36` per second — `0.18`, `0.36` and `0.54` of a heat point over one
// frame, which is one, two and three times the same step. A build with one
// setpoint for every level reads the same number three times.
//
// THEN, THE REDLINE. `specs/towers.md` puts the Lance's redline at `92`, and
// `92` falls between the level-II setpoint and the level-III one, so a Lance
// held at its redline gains NOTHING from a level-I or level-II Forge and gains
// `0.9 * 2 * (96 - 92)` per second from a level-III one. That is the whole of
// "only a level-III Forge drives a Lance past its 92 redline", read as a flow at
// the redline itself rather than as a settling point a long drive would have to
// wait for — and the level-III reading is divided by the Lance's mass of `2.8`,
// which is why it is a twenty-fifth of the Arc readings above.
//
// EVERY OTHER FLOW IS POSED OUT OF ALL SIX ARRANGEMENTS: each subject's
// remaining faces carry plain walls at its own heat, which takes the air term to
// zero and leaves conduction at a gradient of zero, and each reading is ONE
// FRAME, so no wall's own cooling reaches the subject (`movers/contact.ts`).
//
// The two halves stand on two floors because each needs all three boxed anchors.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  FORGE_K,
  FORGE_SETPOINT,
  MAX_LEVEL,
  type TowerType,
} from "../constants";
import {
  captureStill,
  createHarness,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { sizeOf } from "../thermal";
import { massOf, poseBoxed, readHeat } from "./contact";

/** The three levels `specs/towers.md` gives a tower, in order. */
const LEVELS = [1, 2, 3] as const;

/** The gun the setpoint table is read on, and the heat all three open at. */
const GUN: TowerType = "arc";
const PROBE_HEAT = 60;

/** The gun the redline claim is read on, and the redline `specs/towers.md` gives it. */
const REDLINE_GUN: TowerType = "lance";
const REDLINE = 92;

/** A 2x2 face is two edge-tiles, so a flush 2x2 Forge is a contact of two. */
const SHARED_EDGES = sizeOf("forge");

/** The frame every reading is taken over, in seconds of game time. */
const DT = seconds(1);

/** What one frame of a level-`level` Forge must add to a `gun` at `heat`. */
function expectedGain(gun: TowerType, heat: number, level: number): number {
  return (
    (FORGE_K *
      SHARED_EDGES *
      Math.max(0, FORGE_SETPOINT[level - 1] - heat) *
      DT) /
    massOf(gun)
  );
}

/**
 * How close each Arc reading must come, as decimal places of a heat point.
 *
 * Two places is `0.005`, under three percent of the `0.18` step between two
 * adjacent levels, and each reading is one multiplication over figures the
 * specification states exactly. A build whose setpoint does not move with the
 * level misses by that whole step or more.
 */
const TABLE_DIGITS = 2;

/**
 * How close each Lance reading must come, as decimal places of a heat point.
 *
 * Three places is `0.0005`. The readings that must stay apart here are the
 * `0` a level-I or level-II Forge is required to add at the redline and the
 * `0.0214` a level-III one adds, so the bound is a fortieth of the gap between
 * them — and float slack on a frame whose every other term is identically zero
 * is many orders below it.
 */
const REDLINE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The setpoint rises with the level", async () => {
  // The table: three Arcs at 60, one Forge level each, read in one frame.
  await startRun(h);
  const guns = [];
  for (const level of LEVELS) {
    guns.push({
      level,
      boxed: await poseBoxed(
        h,
        { type: GUN, heat: PROBE_HEAT },
        [{ type: "forge", side: "N", level }],
        level - 1,
      ),
    });
  }
  const openedGuns = [];
  for (const gun of guns) {
    openedGuns.push(
      await readHeat(h, gun.boxed.id, `the ${GUN} beside a level-${gun.level} Forge`),
    );
  }
  await h.advance(1);
  await captureStill(h, "levels");
  for (const [index, gun] of guns.entries()) {
    const closed = await readHeat(
      h,
      gun.boxed.id,
      `the ${GUN} beside a level-${gun.level} Forge, a frame on`,
    );
    assertCloseTo(
      closed - openedGuns[index],
      expectedGain(GUN, PROBE_HEAT, gun.level),
      TABLE_DIGITS,
      `the heat a level-${gun.level} Forge, whose setpoint specs/towers.md ` +
        `puts at ${FORGE_SETPOINT[gun.level - 1]}, adds to a ${GUN} at ` +
        `${PROBE_HEAT} over one frame`,
    );
  }

  // The redline: a Lance held at 92, one Forge level each, read in one frame.
  await startRun(h);
  const lances = [];
  for (const level of LEVELS) {
    lances.push({
      level,
      boxed: await poseBoxed(
        h,
        { type: REDLINE_GUN, heat: REDLINE },
        [{ type: "forge", side: "N", slot: 0, level }],
        level - 1,
      ),
    });
  }
  const openedLances = [];
  for (const lance of lances) {
    openedLances.push(
      await readHeat(
        h,
        lance.boxed.id,
        `the ${REDLINE_GUN} at its redline beside a level-${lance.level} Forge`,
      ),
    );
  }
  await h.advance(1);
  for (const [index, lance] of lances.entries()) {
    const closed = await readHeat(
      h,
      lance.boxed.id,
      `the ${REDLINE_GUN} at its redline beside a level-${lance.level} Forge, ` +
        "a frame on",
    );
    const gained = closed - openedLances[index];
    assertCloseTo(
      gained,
      expectedGain(REDLINE_GUN, REDLINE, lance.level),
      REDLINE_DIGITS,
      `the heat a level-${lance.level} Forge adds to a ${REDLINE_GUN} sitting ` +
        `on its ${REDLINE} redline over one frame`,
    );
    if (lance.level === MAX_LEVEL) {
      assertGreaterThan(
        closed,
        REDLINE,
        `only a level-${MAX_LEVEL} Forge, whose setpoint is ` +
          `${FORGE_SETPOINT[MAX_LEVEL - 1]}, drives a ${REDLINE_GUN} past its ` +
          `${REDLINE} redline; the heat it reached was`,
      );
    } else {
      assertLessThanOrEqual(
        closed,
        REDLINE,
        `a level-${lance.level} Forge, whose setpoint is ` +
          `${FORGE_SETPOINT[lance.level - 1]}, leaves a ${REDLINE_GUN} at or ` +
          `below its ${REDLINE} redline; the heat it reached was`,
      );
    }
  }
});
