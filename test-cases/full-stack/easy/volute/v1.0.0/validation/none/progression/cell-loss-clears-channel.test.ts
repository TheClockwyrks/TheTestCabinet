// progression/cell-loss-clears-channel — a spent cell removes every core from the
// channel.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": a core reaching the intake
// "spends a cell, which sets the run back as follows", and one row of that table
// is what this point reads: "| The channel | every core removed |". The next row,
// the projectiles discarded, is `progression/cell-loss-discards-projectiles`:
// a build that empties the channel but leaves a shot in flight has to grade
// differently from one that does neither.
//
// THE DRIVE. Level 1 with five cores posed as one segment, the head 20 units
// short of the intake, so the whole segment is still standing on the channel when
// the head arrives — "every core removed" is only readable against cores that
// were there. The inlet is held, so nothing joins them.
//
// TOLERANCES. None on the answer: the reading is a count of what is left, and the
// standing tolerances make a count exact. The 120-tick ceiling on the ride is a
// ceiling rather than a tolerance, covering the 55 the 20 units take at level 1's
// feed speed twice over.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
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

/** A ceiling on the ride, in ticks: twice the 55 the specs' feed speed gives. */
const RIDE_TICKS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every core from the channel when a cell is spent", async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: spacedBlock(POSED_S, POSED_CORES, "halide"),
  });
  const opened = await h.snapshot();
  assertEqual(coreCount(opened), POSED_CORES, "the cores the pose put up");

  const swept = await captureReplay(h, "cleared", () =>
    h.stepUntil((snapshot) => snapshot.cells !== opened.cells, {
      maxTicks: RIDE_TICKS,
      poll: 1,
    }),
  );

  assertTrue(
    swept.hit,
    `a cell spent within ${RIDE_TICKS} ticks of a head posed ` +
      `${INTAKE_S - POSED_S} units short of the intake`,
  );
  assertGreaterThan(
    POSED_CORES,
    1,
    "cores behind the arriving one, so the row is read against a real train",
  );
  assertEqual(
    coreCount(swept.snapshot),
    0,
    "the cores left on the channel after the spend",
  );
});
