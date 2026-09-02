// runs/step-lands-a-completion-within-the-step — the step that reaches a
// completing boundary lands the completion inside the step.
//
// THE RULE. `step` "acts immediately and always leaves the run paused: a run
// mid-cycle, running or paused, completes its current cycle to the boundary, and
// a run paused at a boundary runs one full cycle, as `specs/simulation.md`
// defines one" (`specs/editor.md`, Running the machine). And a cycle's boundary
// ends with the completion test: "After the rises, if every set's tally has
// reached the challenge's `target`, the run completes: the status becomes
// `complete` and the metrics are recorded" (`specs/simulation.md`, Completion and
// metrics). So a step whose cycle ends on that boundary carries the completion
// with it; nothing further is owed to the clock.
//
// THE CONFIGURATION. A challenge whose `target` is `1` — `specs/formats.md`
// requires only that a target is "at least `1`" — with one `set` on the field and
// one loose `sol` resting on its footprint, and the run PAUSED at the boundary of
// cycle `0`. Paused is the state the rule is sharpest in: the clock is held, so
// the only thing that can run the cycle is the step itself, and any status the
// snapshot reports afterwards was reached by the step rather than by time that
// happened to pass.
//
// THE VERDICT is read from the snapshot the step press itself answers, with NO
// FURTHER GAME TIME ADVANCED: `sim.status` is `complete`, the delivery happened
// (the hex is bare and the tally is the target), and the metrics are recorded.
// A build that ran the cycle but deferred the completion test to the next
// advance reports `paused` here and fails, which is the whole of the point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { setPart, solution } from "../formats";
import { ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  moteAt,
  openRun,
  spawnMote,
  stepAction,
  tallyOf,
  type Harness,
} from "../harness";

/** The whole machine: one set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports complete once the step is over, with no further game time", async () => {
  await openRun(h, {
    challenge: ONE_DELIVERY,
    machine: ONE_SET,
    paused: true,
  });
  await spawnMote(h, ORIGIN, "sol");

  const before = await h.snapshot();
  assertNotNull(before.sim, "the run is live before the step");
  assertEqual(
    before.sim?.status,
    "paused",
    "the clock is held, so only the step can run the cycle",
  );
  assertEqual(
    before.sim?.cycle,
    0,
    "the run is paused at the boundary of cycle 0",
  );
  assertEqual(
    tallyOf(before, 0),
    0,
    "nothing has been delivered yet, so the target is not reached before the step",
  );
  assertEqual(
    before.challenge?.target,
    1,
    "the posed challenge asks for one delivery, so one cycle can reach the target",
  );

  await stepAction(h);
  await captureStill(h, "complete");

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still reported after the step");
  assertNull(
    moteAt(after, ORIGIN),
    "the step ran the cycle to its boundary, where the set consumed the product",
  );
  assertEqual(
    tallyOf(after, 0),
    1,
    "the delivery raised the tally to the challenge's target",
  );
  assertEqual(
    after.sim?.status,
    "complete",
    "the boundary the step reached completes the run, inside the step",
  );
  assertEqual(
    after.sim?.cycle,
    0,
    "a completing boundary leaves sim.cycle at the cycle just run",
  );
  assertNear(
    after.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completion leaves the fraction at 0",
  );
  assertNotNull(
    after.sim?.metrics ?? null,
    "the metrics are recorded at the completing boundary",
  );
});
