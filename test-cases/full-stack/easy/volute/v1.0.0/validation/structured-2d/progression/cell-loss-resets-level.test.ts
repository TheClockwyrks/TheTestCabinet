// progression/cell-loss-resets-level — a spent cell restores the level's opening
// figures.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": a core reaching the intake
// "spends a cell, which sets the run back as follows", and four of that table's
// rows are the figures this point reads:
//
//   | Pressure | 0 |
//   | Active machinery | cleared |
//   | Chain step | 1 |
//   | Quota | what a level start leaves it |
//
// What a level start leaves the quota at is fixed by the same file: "A level
// begins with ... the quota at the level's full value less the cores the channel
// opens with", the seed being `specs/channel.md`'s "`12` cores already on the
// channel". So on level 1 that is 45 less 12.
//
// EACH FIGURE IS MOVED OFF ITS OPENING VALUE FIRST, or the point would pass on a
// build that never resets anything.
//
//   Pressure       `setPressure`, which `specs/instrumentation.md` clamps to
//                  0 through 100.
//   Machinery      `grantMachinery("sightline")`, which "become[s] the active
//                  machinery at [its] full duration" of 12 s — longer than the
//                  drive, so it is still in force when the cell is spent. It is
//                  the one timed kind that leaves the feed speed alone, so the
//                  ride to the intake is the level's own.
//   Chain step     The one way it rises: `specs/extraction.md` — "Extraction on a
//                  merge | the previous step plus 1". A lone lead core is caught
//                  by a two-core segment carrying the same charge, and the run
//                  the join completes is extracted at step 2. A core of a
//                  different charge is left standing well behind so the channel
//                  does not empty on an exhausted quota, which would clear the
//                  level instead.
//   Quota          `setQuotaRemaining`, to a count below what a level start
//                  leaves.
//
// Only then is the arriving core posed. `specs/instrumentation.md` says
// `poseTrain` leaves exactly these four alone — "The quota, the pressure, the
// chain step, the active machinery, the projectiles, and the injector are left as
// they are" — so the hall the cell is spent in still carries all four.
//
// TOLERANCES. The chain step, the machinery and the quota are exact: a count, a
// presence, and a count. Pressure takes the case's standing pressure tolerance of
// +/- 0.05, which is a twentieth of the 1.0 a full second of the fastest rise
// this hall could produce would add, and a thousandth of the 50 the drive starts
// from — so a build that never zeroed it cannot pass. The sweep ceilings are
// ceilings rather than tolerances: 60 ticks covers the 28 the merge takes, and 90
// covers the 37 the ride to the intake takes under the raised pressure, both well
// inside the 120 ticks of chain that must still be running when the cell is spent.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNull,
  assertTrue,
} from "../assert";
import {
  INTAKE_S,
  PRESSURE_MIN,
  PRESSURE_TOL,
  SEED_COUNT,
  SPACING,
  levelSpec,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

const LEVEL = 1;

/** A pressure far from 0, and inside the 0-to-100 range the spec clamps to. */
const RAISED_PRESSURE = 50;

/** A quota below the 33 a level-1 start leaves, so "refilled" is readable. */
const PART_SPENT_QUOTA = 20;

/** Where the arriving core is posed: 20 units short of the intake. */
const ARRIVAL_S = INTAKE_S - 20;

/** The lead core the catching segment merges into, mid-channel and clear of both ends. */
const MERGE_LEAD_S = 3000;

/** The catching segment's head, one hundred units behind the lead core. */
const MERGE_CHASE_S = MERGE_LEAD_S - 100;

/** A core of another charge, left standing so the extraction cannot empty the channel. */
const BYSTANDER_S = 1000;

const MERGE_TICKS = 60;
const LOSS_TICKS = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts pressure, machinery, chain and quota back to a level's opening figures", async () => {
  // The chain first, because the only way it rises is an extraction the game
  // itself makes, and the pose that follows leaves it alone.
  await poseHall(h, {
    level: LEVEL,
    quotaRemaining: 0,
    pressure: 0,
    cores: [
      [MERGE_LEAD_S, "sulfur", null],
      [MERGE_CHASE_S, "sulfur", null],
      [MERGE_CHASE_S - SPACING, "sulfur", null],
      [BYSTANDER_S, "cobalt", null],
    ],
  });
  const chained = await h.stepUntil((snapshot) => snapshot.chainStep > 1, {
    maxTicks: MERGE_TICKS,
    poll: 1,
  });
  assertTrue(
    chained.hit,
    `the chain step past 1 within ${MERGE_TICKS} ticks of a merge that ` +
      "completes a same-charge run of three",
  );

  // The other three figures, and then the core that will reach the intake.
  h.debug.setPressure(RAISED_PRESSURE);
  h.debug.setQuotaRemaining(PART_SPENT_QUOTA);
  h.debug.poseTrain([[ARRIVAL_S, "halide", null]]);
  h.debug.grantMachinery("sightline");

  const posed = h.snapshot();
  assertNear(
    posed.pressure,
    RAISED_PRESSURE,
    PRESSURE_TOL,
    "the pressure the hall was raised to before the setback",
  );
  assertEqual(
    posed.machinery?.kind ?? null,
    "sightline",
    "the machinery in force before the setback",
  );
  assertGreaterThan(
    posed.chainStep,
    1,
    "the chain step the merge extraction left before the setback",
  );
  assertEqual(
    posed.quotaRemaining,
    PART_SPENT_QUOTA,
    "the part-spent quota before the setback",
  );

  const swept = await h.stepUntil(
    (snapshot) => snapshot.cells !== posed.cells,
    {
      maxTicks: LOSS_TICKS,
      poll: 1,
    },
  );
  captureStill(h, "reset");
  assertTrue(
    swept.hit,
    `a cell spent within ${LOSS_TICKS} ticks of a core posed ` +
      `${INTAKE_S - ARRIVAL_S} units short of the intake`,
  );

  const after = swept.snapshot;
  assertNear(
    after.pressure,
    PRESSURE_MIN,
    PRESSURE_TOL,
    "the pressure after the cell was spent",
  );
  assertNull(
    after.machinery,
    "the machinery in force after the cell was spent",
  );
  assertEqual(after.chainStep, 1, "the chain step after the cell was spent");
  assertEqual(
    after.quotaRemaining,
    levelSpec(LEVEL).quota - SEED_COUNT,
    "the quota after the cell was spent, which is what a level start leaves it",
  );
});
