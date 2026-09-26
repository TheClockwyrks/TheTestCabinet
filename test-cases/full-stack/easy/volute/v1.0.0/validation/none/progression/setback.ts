// progression/setback — the arrival the four cell-spend points share.
//
// WHAT THEY ALL DECIDE. `specs/progression.md` — "Cells": a core reaching the
// intake "spends a cell, which sets the run back as follows", and the table that
// follows has seven rows. Four of them are figures a level start fixes:
//
//   | Pressure | 0 |
//   | Active machinery | cleared |
//   | Chain step | 1 |
//   | Quota | what a level start leaves it |
//
// Each is a separate thing a build implements and a separate point, because a
// build that zeroes the pressure and leaves a sightline running has to grade
// differently from one that does neither. The two remaining rows — the channel
// emptied and the projectiles discarded — are `progression/cell-loss-clears-
// channel` and `progression/cell-loss-discards-projectiles`.
//
// THE ARRIVAL. One core posed {@link ARRIVAL_GAP} units short of the intake on an
// otherwise empty channel, with the inlet held so nothing joins it, and the hall
// driven until the cell count moves. Each point moves the ONE figure it decides
// off its opening value before the arrival and reads that figure alone
// afterwards: a point whose figure was never moved would pass on a build that
// resets nothing at all.
//
// WHICH SIDE OF THE FORK A DRIVE TAKES. `poseHall` leaves the cells at `CELLS`
// (`3`) unless a point names otherwise, so the spend is "A cell spent with cells
// remaining" and the run is set back rather than ended
// (`specs/progression.md` — "Interludes and endings"). The screen that spend
// reaches is `progression/setback-screen`'s point.
//
// `progression/game-over` poses `cells: 1` through this same helper instead, so
// its spend is the one that takes the count to 0 and ends the run. That is what
// the surface's `setCells` buys: the point that decides "the run ends with the
// last cell" poses the last cell and drives ONE arrival, rather than driving
// three in sequence and failing whenever the first or the second went wrong —
// which is `progression/cell-lost-at-intake`'s requirement, not this one.

import { assertTrue } from "../assert";
import { INTAKE_S } from "../constants";
import {
  poseHall,
  type Harness,
  type PoseOptions,
  type VoluteSnapshot,
} from "../harness";

/** The level every one of them is driven on. */
export const LEVEL = 1;

/** How far short of the intake the arriving core is posed. */
export const ARRIVAL_GAP = 20;

/** Where the arriving core stands when the hall is posed. */
export const ARRIVAL_S = INTAKE_S - ARRIVAL_GAP;

/**
 * A ceiling on the ride, in ticks.
 *
 * The 20 units take 55 ticks at level 1's feed speed of 22 units/s and 37 at the
 * raised pressure the pressure point poses, so 90 is a ceiling rather than a
 * tolerance — and it stays inside the 120 ticks of chain the chain point needs
 * still to be running when the cell is spent.
 */
export const LOSS_TICKS = 90;

/** What a drive hands back: the hall as posed, and the tick the cell was spent on. */
export interface Setback {
  /** The hall the arrival was driven from, read before any tick ran. */
  posed: VoluteSnapshot;
  /** The tick the cell count moved on. */
  spent: VoluteSnapshot;
}

/**
 * Pose the hall with the figure a point moves, and drive the arrival.
 *
 * The `posed` reading is what lets a point assert its figure was really moved off
 * the value a level start leaves it; without it the point would pass on a build
 * that resets nothing. The drive fails the point when the core never reaches the
 * intake, since a hall that never spent a cell decides nothing either way.
 */
export async function driveArrival(
  h: Harness,
  options: PoseOptions = {},
): Promise<Setback> {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [[ARRIVAL_S, "halide", null]],
    ...options,
  });
  const posed = await h.snapshot();
  const swept = await h.stepUntil(
    (snapshot) => snapshot.cells !== posed.cells,
    { maxTicks: LOSS_TICKS, poll: 1 },
  );
  assertTrue(
    swept.hit,
    `a cell spent within ${LOSS_TICKS} ticks of a core posed ` +
      `${ARRIVAL_GAP} units short of the intake`,
  );
  return { posed, spent: swept.snapshot };
}
