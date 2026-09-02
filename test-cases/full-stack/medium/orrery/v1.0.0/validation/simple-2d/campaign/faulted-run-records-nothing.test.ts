// campaign/faulted-run-records-nothing — a run that ends in a fault leaves the
// course exactly as it found it.
//
// THE RULE. Marking, unlocking and recording all hang off ONE event: "After the
// rises, if every set's tally has reached the challenge's `target`, the run
// completes: the status becomes `complete` and the metrics are recorded ...
// Completing a challenge marks it solved, unlocks what its mode unlocks, and
// updates the challenge's records" (`specs/simulation.md`, Completion and metrics).
// A fault is the other ending — "A fault freezes the run where it stood: the status
// becomes `faulted`" — and it is not a completion, so none of the three follows it.
//
// THE WORLD IS A CAMPAIGN CHALLENGE WITH A MACHINE THAT CANNOT RUN. Challenge 1 is
// opened as the course's own — `openChallenge` "reports it under that `mode` and
// `index`" (`specs/instrumentation.md`), where a challenge loaded as a document
// "touches no progress and no record" whatever it does, which would decide nothing
// here. Its machine is one piston at rest length `ARM_MIN_LEN` with `retract` in
// tape cell `0`: "`overretracted` — `retract` on a piston already at `ARM_MIN_LEN`
// (`1`)" (`specs/simulation.md`, Faults), raised at the fetch before anything moves.
// The completion switch is left ON, so the run is stopped by the fault rather than
// by the switch — which is the whole point: a build that recorded on any ending
// would record here.
//
// BOTH KINDS OF RECORD ENTRY ARE UNDER THE RUN. The challenge is given a record
// through `setRecord` first, so the check decides "leaves its records entry exactly
// as it stood, SET or unset" on a SET one — the harder half, because an entry a
// faulted run overwrote with the faulted machine's cost would read differently.
//
// THE VERDICT. `sim.status` is `faulted`; `campaign.solved` does not hold the
// challenge; `campaign.records[0]` is exactly the entry that was posed; and
// `campaign.unlockedCount` is where it stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { ARM_MIN_LEN, SPEEDS } from "../constants";
import { armPart, solution } from "../formats";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  setSpeed,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The fastest speed step; a run's outcome does not turn on it. */
const FAST_SPEED = SPEEDS.length - 1;

it("marks nothing, records nothing and unlocks nothing when the run faults", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    1,
    "the course holds a challenge after challenge 1, so an unlock this run has " +
      "no business making would be visible in the count",
  );
  await h.debug.setRecord("campaign", 0, "cost", 3);
  await h.debug.setRecord("campaign", 0, "cycles", 5);
  await h.debug.setRecord("campaign", 0, "area", 7);
  const stood = (await h.snapshot()).campaign;

  await openChallenge(h, "campaign", 0);
  await loadMachine(
    h,
    solution([armPart("piston", 0, 0, 0, ARM_MIN_LEN, ["retract"])]),
  );
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);
  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "faulted-no-progress");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "faulted",
    "retract on a piston already at ARM_MIN_LEN faults, so the run ends in a " +
      "status of faulted rather than complete",
  );
  assertEqual(
    after.campaign.solved.includes(0),
    false,
    "a faulted run is not a completion, so it leaves the challenge out of the " +
      "solved set",
  );
  assertDeepEqual(
    after.campaign.records[0] ?? null,
    stood.records[0] ?? null,
    "a faulted run records no metrics, so the challenge's records entry is " +
      "exactly the one that stood before it",
  );
  assertEqual(
    after.campaign.unlockedCount,
    stood.unlockedCount,
    "a faulted run unlocks nothing, so the unlocked count is where it stood",
  );
});
