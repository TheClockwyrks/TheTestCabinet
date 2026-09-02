// runs/cycle-counter-increments-at-each-boundary — a boundary that neither faults
// nor completes raises `sim.cycle` by exactly one, and the machine goes on into
// the next cycle.
//
// THE RULE. "`sim.cycle` counts completed cycles" and, at the end of the cycle's
// fifth step, "When the run does not complete, `sim.cycle` increments and the next
// cycle begins" (`specs/simulation.md`, Cycles and the clock). Which cell that next
// cycle runs is the same section: "each arm and wheel executes its tape cell at
// index `sim.cycle` modulo the period `P`".
//
// THE CONFIGURATION. One piston at `(0, 0)`, rest length `ARM_MIN_LEN` (`1`), on
// the three-cell tape `extend, blank, retract`, so period `P` is `3` and the three
// boundaries this check crosses each run a DIFFERENT cell: cycle `0` extends to
// `2`, cycle `1` rests — "A blank cell is a rest on every part ... and never
// faults" — and cycle `2` retracts back to `1`. None of the three can fault, since
// the length stays inside `ARM_MIN_LEN` (`1`) and `ARM_MAX_LEN` (`3`), and none can
// complete, because the machine holds no set and "A run whose machine holds no set
// never completes" and the completion switch is held off besides. The field is
// empty, so there is no mote to collide and no sigil to act.
//
// THE VERDICT. Across the three boundaries `sim.cycle` reads `1`, then `2`, then
// `3` — up by exactly one each time, never by two and never held. `sim.fraction`
// is back at `0` at each of them, and `sim.status` is still `running` with no
// fault, which is what makes each of the three the boundary this item names. The
// piston's live length reads `2`, `2`, `1` alongside them: the next cycle really
// began each time, and ran its own cell of the tape rather than repeating the one
// before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The tape the subject runs: one cell per cycle this check crosses. */
const TAPE = ["extend", null, "retract"] as const;

/** The piston's live length at each of the three boundaries, in order. */
const LENGTHS = [2, 2, ARM_MIN_LEN] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises sim.cycle by exactly one at each of three boundaries", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [...TAPE]),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;

  const opened = await h.snapshot();
  assertNotNull(opened.sim, "startRun leaves a live run at cycle 0");
  assertEqual(
    opened.sim?.cycle,
    0,
    "the machine begins cycle 0, none completed yet",
  );
  assertEqual(
    poseOf(opened, piston)?.length,
    ARM_MIN_LEN,
    "the piston starts the run at its rest length, ARM_MIN_LEN",
  );

  const crossed = await captureReplay(h, "counting", async () => {
    const seen: OrrerySnapshot[] = [];
    for (let i = 0; i < LENGTHS.length; i += 1) {
      await advanceCycles(h, 1);
      seen.push(await h.snapshot());
    }
    return seen;
  });

  for (const [index, snapshot] of crossed.entries()) {
    const cycle = index + 1;
    assertEqual(
      snapshot.sim?.status,
      "running",
      `boundary ${cycle} neither faults nor completes, so the run is still running`,
    );
    assertNull(
      snapshot.sim?.fault,
      `boundary ${cycle} raises no fault, which is the boundary this point names`,
    );
    assertEqual(
      snapshot.sim?.cycle,
      cycle,
      `boundary ${cycle} raises sim.cycle by exactly 1, to ${cycle}`,
    );
    assertNear(
      snapshot.sim?.fraction ?? -1,
      0,
      FRACTION_TOLERANCE,
      `the span covered exactly ${cycle} cycles, so the run stands on boundary ${cycle}`,
    );
    assertEqual(
      poseOf(snapshot, piston)?.length,
      LENGTHS[index],
      `cycle ${index} ran tape cell ${index} of ${TAPE.length}, so the next cycle began at each boundary`,
    );
  }
});
