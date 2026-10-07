// runs/play-inert-in-a-terminal-status — once a run has stopped, for a fault or for
// a completion, `play` does not restart it, resume it, or move it anywhere.
//
// THE RULE. "while it is `faulted` or `complete`, `play`, `step`, and the speed
// actions do nothing" (`specs/editor.md`, Running the machine). `specs/controls.md`
// says it as a table, giving the row "`editor`, `faulted` or `complete` | `back` and
// `mute`, and `up`, `down`, and `confirm` while the solved panel of `specs/ui.md` is
// up", under the rule "An action a row omits does nothing on that screen." What is
// left standing is `specs/simulation.md`'s "A fault freezes the run where it stood:
// the status becomes `faulted` and nothing advances further."
//
// EACH HALF CARRIES ITS OWN CONTROL. Before the run reaches its terminal status,
// `play` is pressed twice while it is still going and read toggling `running` to
// `paused` and back. So the press made afterwards is a press of an action this build
// demonstrably reads — a build in which `play` never worked at all cannot pass this
// check by doing nothing.
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
// THE VERDICT. In each world the status after the press is the status the run
// stopped in, and `sim.cycle` is the cycle it stopped in. Then four cycles' worth of
// game time is driven and both stand again: the press started nothing that a later
// frame could carry, which is the whole of "no cycle runs".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { armPart, setPart, solution } from "../formats";
import { BARE, EAST, ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  openRun,
  playAction,
  type Harness,
} from "../harness";

/** How much game time is driven after the press, to read that no cycle runs. */
const AFTERWARDS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Toggle the live run with play, twice, and read it move both ways. */
async function toggleWhileLive(): Promise<void> {
  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.status,
    "running",
    "the control presses are made while the run is still going, when play is live",
  );

  await playAction(h);
  assertEqual(
    (await h.snapshot()).sim?.status,
    "paused",
    "the control: play is read while the run is going, and toggles it to paused",
  );

  await playAction(h);
  assertEqual(
    (await h.snapshot()).sim?.status,
    "running",
    "the control: play toggles it back to running, and the run goes on to its end",
  );
}

/** Press play and read back that the stopped run neither moved nor ran a cycle. */
async function assertInert(status: string, cycle: number): Promise<void> {
  await playAction(h);
  await captureStill(h, "inert");

  const pressed = await h.snapshot();
  assertEqual(
    pressed.sim?.status,
    status,
    `play does nothing while the status is ${status}: the status stands`,
  );
  assertEqual(
    pressed.sim?.cycle,
    cycle,
    `play runs no cycle while the status is ${status}: sim.cycle stands at ${cycle}`,
  );

  await advanceCycles(h, AFTERWARDS);

  const later = await h.snapshot();
  assertEqual(
    later.sim?.status,
    status,
    `the press started nothing: ${AFTERWARDS} cycles of game time leave the status ${status}`,
  );
  assertEqual(
    later.sim?.cycle,
    cycle,
    `the press started nothing: ${AFTERWARDS} cycles of game time complete no cycle`,
  );
}

it("leaves a faulted and a completed run exactly as they stood", async () => {
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
  await toggleWhileLive();
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
  await assertInert("faulted", faulted.sim?.cycle ?? -1);

  await openRun(h, {
    challenge: ONE_DELIVERY,
    machine: solution([setPart(0, EAST.q, EAST.r)]),
  });
  await toggleWhileLive();
  await h.debug.setTally(0, (await h.snapshot()).challenge?.target ?? 1);
  await advanceCycles(h, 1);

  const complete = await h.snapshot();
  assertEqual(
    complete.sim?.status,
    "complete",
    "the boundary found every set's tally at the target, so the run completed",
  );
  await assertInert("complete", complete.sim?.cycle ?? -1);
});
