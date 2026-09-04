// progression/setback — the one drive a spent cell's table rows are read off.
//
// `specs/progression.md` — "Cells": a core reaching the intake "spends a cell,
// which sets the run back as follows", and the table that follows has a row per
// figure. Each row is its own point, because each is a thing a build implements
// on its own: a build that zeroes the pressure and leaves a sightline running is
// a different build from one that does neither, and one point cannot tell them
// apart. So the arrangement and the drive live here once and each suite reads the
// one figure it decides off the result.
//
// EACH FIGURE IS MOVED OFF ITS OPENING VALUE FIRST, or a point would pass on a
// build that restores nothing.
//
//   Pressure       `setPressure`, which `specs/instrumentation.md` clamps to
//                  0 through 100.
//   Machinery      `grantMachinery("sightline")`, which becomes "the active
//                  machinery at its full duration" of 12 s — far longer than the
//                  drive, so it is still in force when the cell is spent. It is
//                  the one timed kind that leaves the feed speed alone, so the
//                  ride to the intake is the level's own.
//   Chain step     `setChainStep`, which "sets the chain step an extraction
//                  scores at to `k` ... and restarts the window that returns the
//                  step to `1`", so the posed step is still standing when the
//                  cell is spent. No extraction is driven for it: what raises the
//                  chain is `extraction/chain-increment`'s requirement, and a
//                  point about the setback must not also turn on it.
//   Quota          `setQuotaRemaining`, to a count below what a level start
//                  leaves.
//
// WHAT A LEVEL START LEAVES THE QUOTA AT is fixed by the same file: "A level
// begins with ... the quota at the level's full value less the cores the channel
// opens with", the seed being `specs/channel.md`'s "`12` cores already on the
// channel". So on level 1 that is 45 less 12.
//
// THE HALL HOLDS ONE CORE, the one that arrives. `poseHall` holds the inlet
// (`specs/instrumentation.md`, `setEmission`), so nothing joins the scenario, and
// the posed quota is not exhausted, so the level cannot clear instead.

import { assertTrue } from "../assert";
import { INTAKE_S } from "../constants";
import {
  poseHall,
  type Harness,
  type UntilResult,
  type VoluteSnapshot,
} from "../harness";

/** The level every setback point is read on. */
export const LEVEL = 1;

/** A pressure far from 0, and inside the 0-to-100 range the spec clamps to. */
export const RAISED_PRESSURE = 50;

/** A quota below the 33 a level-1 start leaves, so "refilled" is readable. */
export const PART_SPENT_QUOTA = 20;

/** A chain step above the 1 a level begins at, so "back to 1" is readable. */
export const RAISED_CHAIN_STEP = 3;

/** The timed kind left running across the spend; 12 s outlasts the drive. */
export const STANDING_MACHINERY = "sightline";

/** Where the arriving core is posed: 20 units short of the intake. */
const ARRIVAL_S = INTAKE_S - 20;

/** Comfortably past the 55 ticks the ride takes at level 1's feed speed. */
const LOSS_TICKS = 120;

/** What the drive leaves behind: the hall as posed, and the tick the cell went. */
export interface SetbackDrive {
  /** The hall the drive started from, with all four figures moved. */
  posed: VoluteSnapshot;
  /** The tick the cell count moved on, or the last tick stepped. */
  after: VoluteSnapshot;
  /** Whether a cell was really spent inside the sweep. */
  hit: boolean;
}

/**
 * Pose a level-1 hall with all four figures off their opening values and one core
 * about to reach the intake, then step until the cell count moves.
 *
 * Nothing here decides an outcome: the arrival, the spend, and everything the
 * spend restores come from the ticks stepped after the pose.
 */
export async function driveSetback(h: Harness): Promise<SetbackDrive> {
  await poseHall(h, {
    level: LEVEL,
    pressure: RAISED_PRESSURE,
    quotaRemaining: PART_SPENT_QUOTA,
    chainStep: RAISED_CHAIN_STEP,
    cores: [[ARRIVAL_S, "halide", null]],
    machinery: STANDING_MACHINERY,
  });
  const posed = h.snapshot();
  const swept: UntilResult = await h.stepUntil(
    (snapshot) => snapshot.cells !== posed.cells,
    { maxTicks: LOSS_TICKS, poll: 1 },
  );
  assertTrue(
    swept.hit,
    `a cell spent within ${LOSS_TICKS} ticks of a core posed ` +
      `${INTAKE_S - ARRIVAL_S} units short of the intake`,
  );
  return { posed, after: swept.snapshot, hit: swept.hit };
}
