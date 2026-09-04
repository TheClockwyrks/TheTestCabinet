// runs/speed-actions-inert-in-a-terminal-status — once a run has stopped, for a
// fault or for a completion, the two speed actions do nothing at all.
//
// THE RULE. "While the status is `running` or `paused`, `play` toggles between the
// two and `speed-up` and `speed-down` move the speed step; while it is `faulted` or
// `complete`, `play`, `step`, and the speed actions do nothing" (`specs/editor.md`,
// Running the machine). `specs/controls.md` says it as a table, giving the row
// "`editor`, `faulted` or `complete` | `back` and `mute`, and `up`, `down`, and
// `confirm` while the solved panel of `specs/ui.md` is up", under the rule "An
// action a row omits does nothing on that screen." What is left standing is the
// setting: `sim.speed` is a field of the run, and "A fault freezes the run where it
// stood ... and nothing advances further" (`specs/simulation.md`).
//
// EACH HALF CARRIES ITS OWN CONTROL. Before the run reaches its terminal status, one
// press of `speed-up` is made while it is still `running`, and the setting is read
// moving from `DEFAULT_SPEED_INDEX` (`1`) to `2`. So the presses made afterwards are
// presses of an action this build demonstrably reads — a build in which `speed-up`
// never worked at all cannot pass this check by doing nothing — and `2` rather than
// the default is what "stands where the run left it" then means.
//
// THE FAULTED WORLD. One piston at `(0, 0)`, rest length `ARM_MIN_LEN` (`1`), on the
// tape `extend, extend, extend`: the first two take it to `ARM_MAX_LEN` (`3`) and the
// third is "`extend` on a piston already at `ARM_MAX_LEN` (`3`)", which
// `specs/simulation.md` raises as `overextended`.
//
// THE COMPLETE WORLD. `ONE_DELIVERY`, whose `target` is `1`, with a machine holding
// its one set — "A run whose machine holds no set never completes" — the completion
// switch left on, and the tally posed to the target with `setTally` so that the next
// boundary completes the run.
//
// THE VERDICT. In each world, after the run has stopped, one `speed-up` and one
// `speed-down` each leave `sim.speed` at `2`, and the status stands where the run
// left it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN, DEFAULT_SPEED_INDEX } from "../constants";
import { armPart, setPart, solution } from "../formats";
import { BARE, EAST, ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  openRun,
  pressAction,
  type Harness,
} from "../harness";

/** The step the control press leaves the run at, and the one it must keep. */
const LEFT_AT = DEFAULT_SPEED_INDEX + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Press speed-up while the run is still going, and read the setting move to 2. */
async function raiseWhileRunning(): Promise<void> {
  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.status,
    "running",
    "the control press is made while the run is still running, when the action is live",
  );
  assertEqual(
    opened.sim?.speed,
    DEFAULT_SPEED_INDEX,
    `a run starts at DEFAULT_SPEED_INDEX (${DEFAULT_SPEED_INDEX})`,
  );

  await pressAction(h, "speed-up");

  const raised = await h.snapshot();
  assertEqual(
    raised.sim?.speed,
    LEFT_AT,
    `the control: speed-up is read while the run is running, and moves the setting to ${LEFT_AT}`,
  );
}

/** Press both speed actions and read back that neither moved the setting. */
async function assertInert(status: string): Promise<void> {
  for (const action of ["speed-up", "speed-down"] as const) {
    await pressAction(h, action);
    await captureStill(h, "inert");

    const after = await h.snapshot();
    assertEqual(
      after.sim?.status,
      status,
      `${action} does not move a ${status} run out of its status`,
    );
    assertEqual(
      after.sim?.speed,
      LEFT_AT,
      `${action} does nothing while the status is ${status}: the speed stands where the run left it, at ${LEFT_AT}`,
    );
  }
}

it("leaves sim.speed where the run left it under speed-up and speed-down, faulted and complete", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [
        "extend",
        "extend",
        "extend",
      ]),
    ]),
  });
  await raiseWhileRunning();
  await advanceCycles(h, 8);

  const faulted = await h.snapshot();
  assertNotNull(
    faulted.sim,
    "the run is still live after the cycle that faulted it",
  );
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "the third extend is on a piston already at ARM_MAX_LEN, so the run faults",
  );
  assertEqual(
    faulted.sim?.speed,
    LEFT_AT,
    `the fault freezes the run with the speed the control left it at, ${LEFT_AT}`,
  );
  await assertInert("faulted");

  await openRun(h, {
    challenge: ONE_DELIVERY,
    machine: solution([setPart(0, EAST.q, EAST.r)]),
  });
  await raiseWhileRunning();
  await h.debug.setTally(0, (await h.snapshot()).challenge?.target ?? 1);
  await advanceCycles(h, 1);

  const complete = await h.snapshot();
  assertEqual(
    complete.sim?.status,
    "complete",
    "the boundary found every set's tally at the target, so the run completed",
  );
  assertEqual(
    complete.sim?.speed,
    LEFT_AT,
    `the completed run stands at the speed the control left it at, ${LEFT_AT}`,
  );
  await assertInert("complete");
});
