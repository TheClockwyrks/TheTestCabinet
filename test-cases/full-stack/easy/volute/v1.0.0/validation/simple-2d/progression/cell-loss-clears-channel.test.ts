// progression/cell-loss-clears-channel — a spent cell empties the channel.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": a core reaching the intake
// "spends a cell, which sets the run back as follows", and one row of that table
// is what this point reads:
//
//   | The channel | every core removed |
//
// WHAT THIS CHECK DOES NOT DECIDE. The next row — "Projectiles | every one
// discarded" — is a separate requirement a build can miss on its own: a build
// that empties the channel and leaves a core in flight is a distinct defect, and
// it is graded by `progression/cell-loss-discards-projectiles`. This one reads
// the channel alone, and fires nothing.
//
// THE DRIVE. Level 1 with five cores posed as one segment, the head 20 units
// short of the intake, so the whole segment is on the channel when the head
// arrives and a build that removed only the arriving core is caught. The quota is
// left part-spent and the inlet held by `poseHall`, so nothing arrives to join
// the segment and the emptied channel does not clear the level, which would take
// the reading off the spend.
//
// TOLERANCES. None on the answer: the reading is a count of what is left, and the
// standing tolerances make a count exact. The sweep ceiling is a ceiling rather
// than a tolerance — 120 ticks covers the 55 the ride takes at level 1's feed
// speed twice over.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { INTAKE_S } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  spacedBlock,
  type Harness,
} from "../harness";

/** Cores posed as one segment behind the head, so several are on the channel. */
const POSED_CORES = 5;

/** The head's opening arc position: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** Ceiling on the sweep, in ticks. */
const RIDE_TICKS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every core on the channel when a cell is spent", async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: spacedBlock(POSED_S, POSED_CORES, "halide"),
  });
  const opened = await h.snapshot();
  assertEqual(
    coreCount(opened),
    POSED_CORES,
    "the cores the pose put on the channel",
  );

  const swept = await captureReplay(h, "cleared", () =>
    h.stepUntil((snapshot) => snapshot.cells !== opened.cells, {
      maxTicks: RIDE_TICKS,
      poll: 1,
    }),
  );

  assertTrue(
    swept.hit,
    `a cell spent within ${RIDE_TICKS} ticks of the head being posed ` +
      `${INTAKE_S - POSED_S} units short of the intake`,
  );
  assertEqual(
    coreCount(swept.snapshot),
    0,
    "the cores left on the channel after the spend",
  );
});
