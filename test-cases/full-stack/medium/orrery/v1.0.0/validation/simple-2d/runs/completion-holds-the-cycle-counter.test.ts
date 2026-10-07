// runs/completion-holds-the-cycle-counter — the boundary that completes a run
// leaves `sim.cycle` at the cycle it just ran, and does not increment it the way a
// clean boundary would.
//
// THE RULE. "A completing or faulting boundary leaves `sim.cycle` at the cycle just
// run" (`specs/simulation.md`, Cycles and the clock), against the ordinary case in
// the same paragraph's cycle order: "When the run does not complete, `sim.cycle`
// increments and the next cycle begins." What completes a run is the boundary's
// last step: "After the rises, if every set's tally has reached the challenge's
// `target`, the run completes" (Completion and metrics).
//
// THE CONFIGURATION. `ONE_DELIVERY`, whose `target` is `1`, with a machine holding
// its one set and nothing else — a set is required, since "A run whose machine
// holds no set never completes". The run opens with the completion switch left ON,
// which is what `openRun` is for.
//
// THE COMPLETION IS ARRANGED FOR THE BOUNDARY OF CYCLE `4`, which is the cycle the
// item names. The run is driven four whole cycles and a further `0.4`, so it stands
// inside cycle `4` with `sim.cycle` reading `4` and the run still going; only then
// is the tally posed to the target with `setTally`, a pose that "sets one thing"
// and decides nothing, since "every ... delivery, and completion comes from the
// frames advanced after the pose" (`specs/instrumentation.md`). The next boundary
// the run reaches is the one that ends cycle `4`, and it is the one that reads the
// satisfied target.
//
// THE VERDICT. `sim.status` is `complete` and `sim.cycle` still reads `4`. The
// reading before the completing boundary is what makes that a counter that climbed
// to `4` and stopped rather than one that never moved, and a build that incremented
// at the completing boundary reports `5`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { setPart, solution } from "../formats";
import { EAST, ONE_DELIVERY } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureStill,
  createHarness,
  openRun,
  tallyOf,
  type Harness,
} from "../harness";

/** The cycle whose boundary completes the run. */
const COMPLETING_CYCLE = 4;

/** How far into cycle 4 the run stands when the target is posed as reached. */
const PART_WAY = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports sim.cycle 4 when the boundary of cycle 4 completes the run", async () => {
  await openRun(h, {
    challenge: ONE_DELIVERY,
    machine: solution([setPart(0, EAST.q, EAST.r)]),
  });

  const opened = await h.snapshot();
  assertNotNull(
    opened.sim,
    "startRun leaves a live run on the posed challenge",
  );
  assertEqual(
    opened.completion,
    true,
    "openRun leaves the completion switch on, so a satisfied target ends the run",
  );
  const target = opened.challenge?.target ?? 0;
  assertEqual(
    target,
    1,
    "ONE_DELIVERY's target is 1, so one delivery satisfies it",
  );

  await advanceCycles(h, COMPLETING_CYCLE);
  await advanceFraction(h, PART_WAY);
  await h.debug.setTally(0, target);

  const inside = await h.snapshot();
  assertEqual(
    inside.sim?.status,
    "running",
    "four clean boundaries neither faulted nor completed, so the run is still going",
  );
  assertEqual(
    inside.sim?.cycle,
    COMPLETING_CYCLE,
    `${COMPLETING_CYCLE} boundaries have been crossed, so the run is inside cycle ${COMPLETING_CYCLE}`,
  );
  assertEqual(
    tallyOf(inside, 0),
    target,
    "setTally leaves the one product's tally at the challenge's target",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "complete");

  const done = await h.snapshot();
  assertEqual(
    done.sim?.status,
    "complete",
    `the boundary of cycle ${COMPLETING_CYCLE} found every set's tally at the target, so the run completed`,
  );
  assertEqual(
    done.sim?.cycle,
    COMPLETING_CYCLE,
    `a completing boundary leaves sim.cycle at the cycle just run, ${COMPLETING_CYCLE}, rather than incrementing it`,
  );
});
