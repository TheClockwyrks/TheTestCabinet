// runs/fault-holds-the-cycle-counter — a fault freezes `sim.cycle` at the cycle
// the run was in, and does not increment it the way a clean boundary would.
//
// THE RULE. "A completing or faulting boundary leaves `sim.cycle` at the cycle just
// run" (`specs/simulation.md`, Cycles and the clock), where an ordinary boundary
// instead ends "When the run does not complete, `sim.cycle` increments and the next
// cycle begins". A fault stops everything besides: "A fault freezes the run where
// it stood: the status becomes `faulted` and nothing advances further" (Faults).
// Which cycle a machine is in is the same section's "The cycle now running is cycle
// `sim.cycle`".
//
// THE CONFIGURATION puts the fault in cycle `4`, which is the cycle the item names.
// One piston at `(0, 0)`, rest length `ARM_MIN_LEN` (`1`), on the five-cell tape
// `extend, extend, blank, blank, extend`: cycle `0` takes it to `2`, cycle `1` to
// `ARM_MAX_LEN` (`3`), cycles `2` and `3` rest — "A blank cell is a rest on every
// part ... and never faults" — and cycle `4` is `extend` on a piston already at
// `ARM_MAX_LEN`, which Faults raises as `overextended`. The field is empty and the
// machine holds nothing else, so no other rule can stop the run first.
//
// FOUR CYCLES REALLY RUN BEFORE THE FAULT, and the check reads that rather than
// assuming it: the run is driven three whole cycles and a further `0.4`, and at
// that moment `sim.cycle` reads `3` with the run still clean and the piston already
// at `ARM_MAX_LEN`. So the `4` read at the end is a counter that climbed to `4` and
// stopped, not a counter that never moved.
//
// THE VERDICT. After enough further game time for six more cycles, `sim.status` is
// `faulted`, the fault is `overextended`, and `sim.cycle` reads `4` — the cycle
// just run. A build that incremented at the faulting boundary reports `5`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** The cycle the tape's fifth cell faults in. */
const FAULTING_CYCLE = 4;

/** Whole cycles driven before the run is read part way through cycle 3. */
const CLEAN_CYCLES = 3;

/** How far into cycle 3 the run is read, before the faulting cycle is reached. */
const PART_WAY = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("freezes reporting sim.cycle 4 when cycle 4 faults", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [
        "extend",
        "extend",
        null,
        null,
        "extend",
      ]),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;

  const opened = await h.snapshot();
  assertNotNull(opened.sim, "startRun leaves a live run at cycle 0");
  assertEqual(opened.sim?.cycle, 0, "the machine begins cycle 0");

  await advanceCycles(h, CLEAN_CYCLES);
  await advanceFraction(h, PART_WAY);

  const clean = await h.snapshot();
  assertEqual(
    clean.sim?.status,
    "running",
    "cycles 0 to 3 raise no fault, so the run is still running inside cycle 3",
  );
  assertNull(clean.sim?.fault, "no fault has been raised before cycle 4");
  assertEqual(
    clean.sim?.cycle,
    CLEAN_CYCLES,
    `${CLEAN_CYCLES} boundaries have been crossed, so the counter has climbed to ${CLEAN_CYCLES}`,
  );
  assertEqual(
    poseOf(clean, piston)?.length,
    ARM_MAX_LEN,
    "the first two cycles really ran: the piston stands at ARM_MAX_LEN, which cycle 4 extends past",
  );

  await advanceCycles(h, 6);
  await captureStill(h, "frozen");

  const frozen = await h.snapshot();
  assertEqual(
    frozen.sim?.status,
    "faulted",
    "cycle 4 extends a piston already at ARM_MAX_LEN, which faults",
  );
  assertEqual(
    frozen.sim?.fault?.kind,
    "overextended",
    "extend on a piston already at ARM_MAX_LEN raises overextended",
  );
  assertEqual(
    frozen.sim?.cycle,
    FAULTING_CYCLE,
    `the fault leaves sim.cycle at the cycle just run, ${FAULTING_CYCLE}, rather than incrementing it`,
  );
});
