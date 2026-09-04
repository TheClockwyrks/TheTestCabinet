// instrumentation/set-paused-throws-while-faulted — a fault cannot be stepped out
// of.
//
// THE RULE. "`setPaused(paused)` | Moves `sim.status` between `running` and
// `paused`, exactly as the `play` toggle moves it. **It throws while the status is
// `faulted` or `complete`**" (`specs/instrumentation.md`, The run). This point
// takes `faulted`; its sibling takes `complete`.
//
// WHY IT MATTERS. "A fault freezes the run where it stood: the status becomes
// `faulted` and nothing advances further" (`specs/simulation.md`, Faults), and the
// editor agrees: "while it is `faulted` or `complete`, `play`, `step`, and the
// speed actions do nothing" (`specs/editor.md`). So there is no path from
// `faulted` back to `running` or `paused`; `back` stops the run, and that is all.
//
// BOTH ARGUMENTS ARE HANDED OVER, because the row bounds the OPERATION rather than
// one of its values: pausing a faulted run and un-pausing one are the same refusal.
// And each refusal is read twice — it threw, and the status is still `faulted` —
// because a build that threw AFTER moving the status would pass the first reading
// and fail the second.
//
// THE FAULT IS THE SIMPLEST ONE THERE IS. "`overextended` | `extend` on a piston
// already at `ARM_MAX_LEN` (`3`)" (`specs/simulation.md`, Faults), raised at the
// fetch step, which is the first thing a cycle does: "Each part reads its tape
// cell for this cycle... A non-blank cell the part cannot perform raises the fault
// named for it." One piston, at the bound, on an emptied field, so nothing moves,
// nothing collides, and nothing else can be what faulted.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, one part, the completion
// switch held off and every mote cleared.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";
import { armPart, solution } from "../formats";

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

it("throws either way and leaves the status faulted", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, ["extend"]),
    ]),
  });

  await advanceCycles(h, 1);
  const faulted = await h.snapshot();
  assertNotNull(faulted.sim, "the run is still live once it has faulted");
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "extend on a piston already at ARM_MAX_LEN faults the run at its fetch",
  );

  const pausing = await outcomeOf(() => h.debug.setPaused(true));
  const afterPausing = await h.snapshot();

  const resuming = await outcomeOf(() => h.debug.setPaused(false));
  const afterResuming = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "faulted");

  assertEqual(
    pausing,
    "threw",
    "setPaused throws an Error while the status is faulted",
  );
  assertEqual(
    afterPausing.sim?.status,
    "faulted",
    "the refused setPaused(true) leaves the status faulted",
  );
  assertEqual(
    resuming,
    "threw",
    "setPaused throws an Error while the status is faulted, whichever way it is called",
  );
  assertEqual(
    afterResuming.sim?.status,
    "faulted",
    "the refused setPaused(false) leaves the status faulted, so a fault cannot be stepped out of",
  );
});
