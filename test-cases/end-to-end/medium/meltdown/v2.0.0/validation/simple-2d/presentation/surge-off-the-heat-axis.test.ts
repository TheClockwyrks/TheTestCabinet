// presentation/surge-off-the-heat-axis — the surge is never mistaken for heat.
//
// THE RULE. specs/overview.md's legibility table: the surge reads apart "from
// every color a tower shows anywhere on its heat ramp". Heat is the one axis in
// this game that carries meaning through colour — an emitter's drawn colour
// tracks it (the same table's first row) — so a unit drawn somewhere on that axis
// is a unit a player reads as a tower's heat. The ramp is read at its two ends
// and at three points between, and a TRIPPED tower is read beside it, because
// specs/heat.md makes a tripped emitter a state of its own and the point names it
// explicitly.
//
// WHAT A TOWER'S COLOUR MEANS HERE. A footprint carries more than one colour: a
// body, an outline, a label, the heat read of specs/hud.md. What this point is
// about is the colour the tower READS AS, so the reading is the one its footprint
// mostly is — the mean of its largest cluster of pixels (presentation/read.ts).
// Asking instead that no unit match ANY pixel a tower draws would be asking a
// build never to put a white outline near a white unit, which the specification
// nowhere says and which nothing about legibility needs.
//
// HOW THE SCENE IS POSED. Six emitters of one type along one row at the six
// readings, and the six surge types along another, well clear of them. One frame,
// because the point's picture is the surge held up against every colour the ramp
// shows. Every tower holds both faculties (presentation/pose.ts), so none fires
// at a unit, none moves its heat, and each is carrying exactly the reading it was
// posed at. Every unit's motion is off, so each is read where it was put.
//
// WHAT IT DOES NOT DECIDE. Whether the ramp itself spreads out is
// `heat-glow-ramp`; whether a tripped tower reads apart from an online one is
// `tripped-reads-apart`; whether the surge reads apart from the floor is
// `surge-reads-apart-from-the-floor`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SURGE_TYPES, TRIP_HEAT } from "../constants";
import { sizeOf } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  startRun,
  unitOf,
  type Harness,
} from "../harness";
import type { TowerType } from "../surface";
import { poseStillTower, poseStillTrippedTower } from "./pose";
import {
  dominant,
  footprintRegion,
  readRegion,
  showRgb,
  spotColor,
} from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a surge type's colour must sit from
 * every colour the ramp shows.
 *
 * The suite's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at.
 */
const APART_MIN = 50;

/**
 * How close two pixels of a footprint must be to count as the same reading, when
 * the check asks what colour the footprint mostly is.
 *
 * Half of `APART_MIN`, and the suite's figure for two readings that are the same
 * thing rather than two things: a body shaded across its own area, a gradient, a
 * pixel softened where it meets an outline. Two readings this close could not be
 * told apart by the player this point is written for, so grouping them is what
 * "the colour the tower reads as" means.
 */
const SAME_READING_MAX = 25;

/** The emitter the ramp is read on, its row, and the columns the six stand on. */
const RAMP_TYPE: TowerType = "lance";
const RAMP_ROW = 24;
const RAMP_COLS: readonly number[] = [3, 9, 15, 32, 38, 44];

/** The five online readings of the ramp; the sixth tower is the tripped one. */
const RAMP_HEATS: readonly number[] = [0, 25, 50, 75, 99];

/** The row the surge stands on, the first column, and the pitch between them. */
const SURGE_ROW = 8;
const SURGE_COL0 = 5;
const SURGE_PITCH = 5;

/** How far inside a footprint the reading starts, and how dense it is. */
const FOOTPRINT_INSET = 3;
const FOOTPRINT_STEP = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every surge type off every colour the heat axis shows", async () => {
  startRun(h);
  const units = SURGE_TYPES.map((type, index) =>
    poseTarget(h, type, SURGE_COL0 + index * SURGE_PITCH, SURGE_ROW),
  );
  RAMP_HEATS.forEach((heat, index) => {
    poseStillTower(h, RAMP_TYPE, RAMP_COLS[index], RAMP_ROW, 0, heat);
  });
  poseStillTrippedTower(
    h,
    RAMP_TYPE,
    RAMP_COLS[RAMP_HEATS.length],
    RAMP_ROW,
    TRIP_HEAT,
  );
  await h.advance(1);
  captureStill(h, "apart");

  const size = sizeOf(RAMP_TYPE);
  const axis = RAMP_COLS.map((col, index) => ({
    name:
      index < RAMP_HEATS.length
        ? `an emitter at heat ${RAMP_HEATS[index]}`
        : "a tripped emitter",
    colour: dominant(
      readRegion(
        h,
        footprintRegion(col, RAMP_ROW, size, FOOTPRINT_INSET),
        FOOTPRINT_STEP,
      ),
      SAME_READING_MAX,
    ),
  }));

  const snapshot = h.snapshot();
  SURGE_TYPES.forEach((type, index) => {
    const unit = unitOf(snapshot, units[index]);
    const body = spotColor(h, unit.x, unit.y);
    for (const reading of axis) {
      assertGreaterThanOrEqual(
        colorDistance(body, reading.colour),
        APART_MIN,
        `a ${type} (${showRgb(body)}) against ${reading.name} ` +
          `(${showRgb(reading.colour)}), out of 441 (specs/overview.md: the ` +
          `surge reads apart from every colour a tower shows anywhere on its ` +
          `heat ramp, tripped included)`,
      );
    }
  });
});
