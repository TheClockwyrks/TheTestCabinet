// instrumentation/set-paused-throws-while-complete — a completed run cannot be
// un-completed.
//
// THE RULE. "`setPaused(paused)` | Moves `sim.status` between `running` and
// `paused`, exactly as the `play` toggle moves it. **It throws while the status is
// `faulted` or `complete`**" (`specs/instrumentation.md`, The run). This point
// takes `complete`; its sibling takes `faulted`.
//
// WHY IT MATTERS. `specs/editor.md`: "while it is `faulted` or `complete`, `play`,
// `step`, and the speed actions do nothing." So there is no path from `complete`
// back to `running` or `paused`; `back` stops the run, and that is all.
//
// BOTH ARGUMENTS ARE HANDED OVER, because the row bounds the OPERATION rather than
// one of its values. And each refusal is read twice — it threw, and the status is
// still `complete` — because a build that threw AFTER moving the status would pass
// the first reading and fail the second.
//
// THE COMPLETION IS POSED, NOT CARRIED OUT. "After the rises, if every set's tally
// has reached the challenge's `target`, the run completes: the status becomes
// `complete` and the metrics are recorded. A run whose machine holds no set never
// completes" (`specs/simulation.md`). So the machine holds its set, `setTally`
// "Sets the tally of the open challenge's product `index`" to the challenge's
// target, and one cycle of game time carries the run to the boundary where the
// check reads it. The challenge's `target` is `1`, which `specs/formats.md` allows
// — it requires only that a target is "at least `1`" — so the pose is one call
// rather than a delivery machine.
//
// THE WORLD IS POSED, NOT SEARCHED. The run is opened with the completion switch
// ON, because completion is the whole subject, and the machine holds exactly the
// one set the tally belongs to. No rise, no arm and no mote is on the field, so
// nothing can raise, carry, or consume anything, and the only thing the boundary
// can find is the tally that was posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openRun,
  type Harness,
} from "../harness";
import { EAST, ONE_DELIVERY } from "../fixtures";
import { setPart, solution } from "../formats";

/** Whether a call threw, as one word, so a failure reads as an expected/actual pair. */
async function outcomeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "returned";
  } catch {
    return "threw";
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws either way and leaves the status complete", async () => {
  await openRun(h, {
    challenge: ONE_DELIVERY,
    machine: solution([setPart(0, EAST.q, EAST.r)]),
  });

  await h.debug.setTally(0, ONE_DELIVERY.target);
  await advanceCycles(h, 1);

  const complete = await h.snapshot();
  assertNotNull(complete.sim, "the run is still live once it has completed");
  assertEqual(
    complete.sim?.status,
    "complete",
    "a boundary at which every set's tally has reached the target completes the run",
  );

  const pausing = await outcomeOf(() => h.debug.setPaused(true));
  const afterPausing = await h.snapshot();

  const resuming = await outcomeOf(() => h.debug.setPaused(false));
  const afterResuming = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "complete");

  assertEqual(
    pausing,
    "threw",
    "setPaused throws an Error while the status is complete",
  );
  assertEqual(
    afterPausing.sim?.status,
    "complete",
    "the refused setPaused(true) leaves the status complete",
  );
  assertEqual(
    resuming,
    "threw",
    "setPaused throws an Error while the status is complete, whichever way it is called",
  );
  assertEqual(
    afterResuming.sim?.status,
    "complete",
    "the refused setPaused(false) leaves the status complete",
  );
});
