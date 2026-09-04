// progression/setback — the staging every cell-spend check in this directory
// shares.
//
// WHAT A SPEND IS. `specs/progression.md` ("Cells"): "A core whose arc position
// `s` reaches 5000 arrives at the intake and spends a cell, which sets the run
// back as follows", and the table that follows fixes seven figures. Each row is a
// requirement a build implements on its own, so each is a point of its own; what
// they share is the hall the spend happens in, which is here.
//
// HOW EACH FIGURE IS MOVED OFF ITS OPENING VALUE. A row that reads "back to the
// opening value" is only readable if the hall was somewhere else first, so the
// pose puts each of the four figures the table names somewhere a level start
// never leaves it, through the single-field poses `specs/instrumentation.md`
// carries for exactly that:
//
//   Pressure       `setPressure(50)`, "clamped to `0` through `100`".
//   Chain step     `setChainStep(3)`, which sets the step "an extraction scores
//                  at" and "restarts the window that returns the step to `1`",
//                  so the posed step is still standing when the cell is spent.
//   Quota          `setQuotaRemaining(20)`, below the 33 a level-1 start leaves.
//   Machinery      `grantMachinery("sightline")`, which becomes the active
//                  machinery "at its full duration" of 12 s — longer than the
//                  drive, so it is still in force when the cell is spent. It is
//                  the one timed kind that leaves the feed speed alone, so the
//                  ride to the intake runs at the level's own rate.
//
// WHY THE QUOTA IS NOT EXHAUSTED. `specs/progression.md` clears a level "the
// moment its quota is exhausted and no cores remain on the channel", and a
// channel a spend has just emptied would meet that on the next tick. The quota
// stands part-spent instead and the inlet is held by `poseHall`'s
// `setEmission(false)`, so nothing arrives, nothing clears, and the screen the
// spend leaves is the screen the spend chose.
//
// WHY THE CELLS ARE LEFT AT THREE. "A spend that takes the count to 0 ends the
// run in place of restarting the level", so a run standing on its last cell would
// reach `gameover` and none of these rows would be read. Three is what a reset
// leaves, and one spend off it is a setback.
//
// WHAT IS RETURNED. The snapshot of the hall as posed, and the snapshot of the
// tick the cell was spent on. Each check reads one figure off the pair.

import { assertNear, assertTrue } from "../assert";
import { INTAKE_S, PRESSURE_TOL } from "../constants";
import { poseHall, type Harness, type VoluteSnapshot } from "../harness";

/** The level the hall opens on, whose quota and feed speed the drive runs under. */
export const LEVEL = 1;

/** A pressure far from 0, and inside the 0-to-100 range the spec clamps to. */
export const RAISED_PRESSURE = 50;

/** A quota below the 33 a level-1 start leaves, so "refilled" is readable. */
export const PART_SPENT_QUOTA = 20;

/** A chain step above the 1 a level start leaves, so "back to 1" is readable. */
export const RAISED_CHAIN = 3;

/** The timed kind left in force across the spend; it leaves the feed alone. */
export const STANDING_MACHINERY = "sightline" as const;

/** Where the arriving core is posed: 20 units short of the intake. */
export const ARRIVAL_S = INTAKE_S - 20;

/**
 * How long the drive waits for the spend, in ticks.
 *
 * 20 units at level 1's feed of 22 units/s raised by a pressure of 50 —
 * "level feed speed x (1 + pressure / 100)" (specs/channel.md) — is 33 units/s,
 * so the ride is 36 ticks. The ceiling is more than twice that, and still well
 * inside the 120 ticks of chain window `setChainStep` left running.
 */
export const LOSS_TICKS = 90;

/** The hall as posed, and the hall on the tick the cell was spent. */
export interface Setback {
  /** The snapshot taken once the pose was complete, before any tick ran. */
  readonly posed: VoluteSnapshot;
  /** The snapshot of the tick the cell was spent on. */
  readonly after: VoluteSnapshot;
}

/**
 * Pose a hall standing away from every opening figure, and run it until a core
 * reaches the intake and spends a cell.
 *
 * Nothing here decides the outcome: the arrival, the spend, and everything the
 * spend sets back come from the ticks this steps.
 */
export async function driveSetback(h: Harness): Promise<Setback> {
  await poseHall(h, {
    level: LEVEL,
    quotaRemaining: PART_SPENT_QUOTA,
    pressure: RAISED_PRESSURE,
    chainStep: RAISED_CHAIN,
    cores: [[ARRIVAL_S, "halide", null]],
    machinery: STANDING_MACHINERY,
  });

  const posed = await h.snapshot();
  // The hall really did stand away from its opening figures, or a build that
  // resets nothing would pass the checks that read this pair.
  assertNear(
    posed.pressure,
    RAISED_PRESSURE,
    PRESSURE_TOL,
    "the pressure the hall was raised to before the spend",
  );

  const swept = await h.stepUntil(
    (snapshot) => snapshot.cells !== posed.cells,
    { maxTicks: LOSS_TICKS, poll: 1 },
  );
  assertTrue(
    swept.hit,
    `a cell spent within ${LOSS_TICKS} ticks of a core posed ` +
      `${INTAKE_S - ARRIVAL_S} units short of the intake`,
  );

  return { posed, after: swept.snapshot };
}
