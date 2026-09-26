// progression/cell-loss-clears-channel — a spent cell empties the channel.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": a core reaching the intake
// "spends a cell, which sets the run back as follows", and one row of that table
// is what this point reads:
//
//   | The channel | every core removed |
//
// The row below it — "Projectiles | every one discarded" — is a separate thing a
// build implements, so it is `progression/cell-loss-discards-projectiles`'s point
// and nothing here fires a shot or reads one.
//
// THE DRIVE. Level 1 with the inlet held and five cores posed as one segment
// with the head 20 units short of the intake, so the whole segment is on the
// channel when the head arrives and the reading is "every core", not "the one
// that arrived".
//
// TOLERANCES. None on the answer: the reading is a count of what is left, and
// the standing tolerances make a count exact. The two sweep ceilings are ceilings
// rather than tolerances — 120 ticks covers the ride to the firing point several
// times over at level 1's feed speed, and 40 covers the last few units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { INTAKE_S } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  poseHall,
  spacedBlock,
  type Harness,
} from "../harness";

/** Cores posed as one segment behind the head, so several are on the channel. */
const POSED_CORES = 5;

/** The head's opening arc position: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** How close the head is let get before the shot is raised. */
const FIRE_WITHIN = 5;

/** Ceilings on the two sweeps, in ticks. */
const RIDE_TICKS = 120;
const LOSS_TICKS = 40;

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
  const opened = h.snapshot();

  const swept = await captureReplay(h, "cleared", async () => {
    const approach = await h.stepUntil(
      (snapshot) => head(snapshot).s >= INTAKE_S - FIRE_WITHIN,
      { maxTicks: RIDE_TICKS, poll: 1 },
    );
    assertTrue(
      approach.hit,
      `the head within ${FIRE_WITHIN} units of the intake inside ` +
        `${RIDE_TICKS} ticks of being posed ${INTAKE_S - POSED_S} units short`,
    );

    assertGreaterThan(
      coreCount(h.snapshot()),
      1,
      "cores standing on the channel when the cell is about to be spent",
    );

    return h.stepUntil((snapshot) => snapshot.cells !== opened.cells, {
      maxTicks: LOSS_TICKS,
      poll: 1,
    });
  });

  assertTrue(
    swept.hit,
    `a cell spent within ${LOSS_TICKS} ticks of the head reaching ` +
      `${INTAKE_S - FIRE_WITHIN}`,
  );
  assertEqual(
    coreCount(swept.snapshot),
    0,
    "the cores left on the channel after the spend",
  );
});
