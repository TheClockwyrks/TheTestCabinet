// progression/cell-lost-at-intake — a core reaching the intake spends a cell.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": "A run starts with 3 cells. A
// core whose arc position `s` reaches 5000 arrives at the intake and spends a
// cell ... A tick spends one cell at most." Its table's first row is the figure
// this point reads: "Cells | one fewer". `specs/channel.md` puts 5000 at the
// intake: "`PATH_LENGTH` (`5000`) is the channel's total arc length ... vertex
// `11` is the intake, at `PATH_LENGTH`."
//
// THE DRIVE. Level 1 with the inlet held and ONE core, posed 20 units short of
// the intake. A lone core is the head, so it is the lead segment and rides at the
// level's feed speed of 22 units/s with pressure at 0 and no machinery, which
// carries it the 20 units in a little over half a second. Nothing else stands on
// the channel, so the cell the run loses can only be this core's arrival.
//
// WHY THE COUNT IS READ BEFORE AND AFTER. The claim is a difference of exactly
// one, not a particular remaining count, so the count the hall opened with is
// read from the build rather than assumed, and the sweep stops on the first tick
// the count moves — which is what makes "exactly one" readable at all, since the
// setback the spend opens restarts the level after 2 s and a later reading would
// be of a hall that had already been rebuilt.
//
// TOLERANCES. None on the answer: a cell count is a count, and the standing
// tolerances make a count exact. The sweep's 90-tick ceiling is a ceiling rather
// than a tolerance — the arrival is due on tick 55 at the level's feed speed, and
// 90 stays well inside the 120 ticks of the interlude that follows it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { INTAKE_S } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** Where the lone core is posed: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** Comfortably past the 55 ticks the ride takes, and inside the 2 s interlude. */
const MAX_TICKS = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends exactly one cell when a core reaches the intake", async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[POSED_S, "halide", null]],
  });

  const opened = await h.snapshot();

  const swept = await captureReplay(h, "intake", () =>
    h.stepUntil((snapshot) => snapshot.cells !== opened.cells, {
      maxTicks: MAX_TICKS,
      poll: 1,
    }),
  );

  assertTrue(
    swept.hit,
    `a cell spent within ${MAX_TICKS} ticks of a core posed ` +
      `${INTAKE_S - POSED_S} units short of the intake`,
  );
  assertEqual(
    swept.snapshot.cells,
    opened.cells - 1,
    "the cells remaining on the tick the core reached the intake",
  );
});
