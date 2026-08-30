// progression/cell-loss-clears-channel — a spent cell empties the channel.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": a core reaching the intake
// "spends a cell, which sets the run back as follows", and the table's next two
// rows are what this point reads:
//
//   | The channel | every core removed |
//   | Projectiles | every one discarded |
//
// THE DRIVE. Level 1 with its quota spent and five cores posed as one segment
// with the head 20 units short of the intake, so the whole segment is on the
// channel when the head arrives. A shot is fired once the head is within a few
// units of the intake, so that a projectile is still in the air on the tick the
// cell is spent — which is the only way the second row can be read at all.
//
// WHERE THE SHOT GOES, AND WHY IT MISSES. It is fired straight up the field at
// the opening aim of 270 degrees, from the injector's fixed center at (420, 330)
// (`specs/injector.md`). The posed cores stand on the channel's second-to-last
// leg, which `specs/channel.md` runs from (620, 320) to (480, 320), so the
// nearest of them is more than 60 units from the line the projectile flies up —
// well outside the 28-unit strike distance. The shot therefore leaves the field
// untouched after 330 units at `PROJECTILE_SPEED`, which is 32 ticks, while the
// head covers its last 5 units in 14 at level 1's feed speed — so the projectile
// is in the air for the spend with better than half its life to spare.
//
// TOLERANCES. None on the answer: both readings are counts of what is left, and
// the standing tolerances make a count exact. The two sweep ceilings are ceilings
// rather than tolerances — 120 ticks covers the ride to the firing point several
// times over at level 1's feed speed, and 40 covers the last few units while
// staying inside the 32 ticks the shot lives for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { INTAKE_S, OPENING_AIM } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  fireAt,
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

it("removes every core and every projectile when a cell is spent", async () => {
  await poseHall(h, {
    level: 1,
    quotaRemaining: 0,
    pressure: 0,
    cores: spacedBlock(POSED_S, POSED_CORES, "halide"),
  });
  const opened = await h.snapshot();

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

    await fireAt(h, OPENING_AIM);
    const armed = await h.snapshot();
    assertGreaterThan(
      armed.projectiles?.length ?? 0,
      0,
      "a projectile in flight when the cell is about to be spent",
    );
    assertGreaterThan(
      coreCount(armed),
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
  assertEqual(
    swept.snapshot.projectiles?.length ?? 0,
    0,
    "the projectiles left in flight after the spend",
  );
});
