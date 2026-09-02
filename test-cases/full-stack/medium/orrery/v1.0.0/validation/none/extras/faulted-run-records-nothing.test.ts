// extras/faulted-run-records-nothing — a run that ends in a fault leaves the shelf
// exactly as it found it.
//
// THE RULE. Marking and recording hang off ONE event: "After the rises, if every
// set's tally has reached the challenge's `target`, the run completes: the status
// becomes `complete` and the metrics are recorded ... Completing a challenge marks
// it solved, unlocks what its mode unlocks, and updates the challenge's records"
// (`specs/simulation.md`, Completion and metrics). A fault is the other ending —
// "A fault freezes the run where it stood: the status becomes `faulted`" — and it
// is not a completion, so neither follows it. The Extras say the same from their
// own side: "a challenge is SOLVED BY A RUN THAT COMPLETES"
// (`specs/modes/extras.md`), and the records a challenge keeps are those "over the
// session's COMPLETED runs of it" (`specs/modes/campaign.md`, which
// `specs/modes/extras.md` adopts).
//
// THE WORLD IS AN EXTRAS CHALLENGE WITH A MACHINE THAT CANNOT RUN. Extras 1 is
// opened as the shelf's own — `openChallenge` "reports it under that `mode` and
// `index`" (`specs/instrumentation.md`), where a challenge loaded as a document
// "touches no progress and no record" whatever it does, which would decide nothing
// here. Its machine is one piston at rest length `ARM_MIN_LEN` with `retract` in
// tape cell `0`: "`overretracted` — `retract` on a piston already at `ARM_MIN_LEN`
// (`1`)" (`specs/simulation.md`, Faults), raised at the fetch before anything
// moves. The completion switch is left ON, so the run is stopped by the fault
// rather than by the switch — which is the whole point: a build that recorded on
// any ending would record here.
//
// BOTH KINDS OF RECORD ENTRY ARE UNDER THE RUN. The challenge is given a record
// through `setRecord` first, so the check decides "leaves its records exactly as
// they stood, SET or unset" on a SET one — the harder half, because an entry a
// faulted run overwrote with the faulted machine's cost would read differently —
// and on nine unset ones at the same time.
//
// THE VERDICT. `sim.status` is `faulted`; `extras.solved` does not hold the
// challenge; and every entry of `extras.records` is exactly the one that stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { ARM_MIN_LEN, SPEEDS } from "../constants";
import { armPart, solution } from "../formats";
import {
  advanceCycles,
  allowCompletion,
  captureReplay,
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

/** Extras 1, counted from `0` as the surface counts a mode's challenges. */
const INDEX = 0;

/**
 * The fastest speed step. A run's outcome does not turn on it — "`advance(1, 1)`
 * and `advance(1, 60)` cover the same cycles and reach the same outcome"
 * (`specs/instrumentation.md`) — so nothing here turns on the choice.
 */
const FAST_SPEED = SPEEDS.length - 1;

it("marks nothing and records nothing when the run faults", async () => {
  await h.debug.reset();
  await h.debug.setRecord("extras", INDEX, "cost", 3);
  await h.debug.setRecord("extras", INDEX, "cycles", 5);
  await h.debug.setRecord("extras", INDEX, "area", 7);
  const stood = (await h.snapshot()).extras;
  assertLength(
    stood.solved,
    0,
    "nothing is solved before the run, so a mark afterwards is one the faulted " +
      "run made",
  );

  await openChallenge(h, "extras", INDEX);
  await loadMachine(
    h,
    solution([armPart("piston", 0, 0, 0, ARM_MIN_LEN, ["retract"])]),
  );
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);

  await captureReplay(h, "faulted", async () => {
    await advanceCycles(h, 1);
    await h.advance(1);
  });

  const after = (await h.snapshot()).extras;
  assertEqual(
    (await h.snapshot()).sim?.status,
    "faulted",
    "retract on a piston already at ARM_MIN_LEN faults, so the run ends in a " +
      "status of faulted rather than complete",
  );
  assertEqual(
    after.solved.includes(INDEX),
    false,
    "a challenge is solved by a run that COMPLETES, so a faulted run leaves it " +
      "out of the mode's solved set",
  );
  assertDeepEqual(
    after.solved,
    stood.solved,
    "a faulted run marks nothing at all, so the mode's solved set is exactly " +
      "the one that stood",
  );
  assertDeepEqual(
    after.records,
    stood.records,
    "a faulted run records no metrics, so every records entry, set or unset, " +
      "is exactly the one that stood",
  );
});
