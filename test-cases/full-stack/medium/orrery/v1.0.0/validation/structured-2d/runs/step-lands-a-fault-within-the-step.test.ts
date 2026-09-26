// runs/step-lands-a-fault-within-the-step — when the cycle a `step` runs is the cycle
// that faults, the run is already `faulted` when the step is over.
//
// THE RULE. "`step` acts immediately and never leaves the run running ... a run
// paused at a boundary runs one full cycle, as `specs/simulation.md` defines one"
// (`specs/editor.md`, Running the machine), and one full cycle includes its first
// step: "Fetch. Each part reads its tape cell for this cycle ... A non-blank cell the
// part cannot perform raises the fault named for it under Faults"
// (`specs/simulation.md`). A fault takes effect where it is raised: "A fault freezes
// the run where it stood: the status becomes `faulted` and nothing advances further."
// So the fault belongs to the step, not to whatever happens next.
//
// THE CONFIGURATION. One `piston` at `(0, 0)` placed at length `ARM_MAX_LEN` (`3`) —
// "For a `piston` the chosen length is its rest length" (`specs/parts.md`), and "Each
// run starts every arm at its rest pose" — on the two-cell tape `blank, extend`. Cycle
// `0` is the blank, which "is a rest on every part ... and never faults"; cycle `1` is
// "`extend` on a piston already at `ARM_MAX_LEN` (`3`)", which Faults raises as
// `overextended`. The field is empty and the machine holds nothing else, so no other
// rule can stop the run first, and the run is opened PAUSED at its settle so that
// nothing but a press ever moves it.
//
// THE FIRST STEP IS THE CONTROL. It runs cycle `0`, which cannot fault, and leaves the
// run paused at the next boundary with `sim.fault` still `null`. So the fault the
// second step lands is a fault raised by the cycle THAT step ran, rather than one the
// run was already carrying.
//
// THE VERDICT. The snapshot taken as the second step returns already reports
// `sim.status` `faulted` and `sim.fault.kind` `overextended`, naming the piston in
// `sim.fault.parts` — "Every fetch fault | the faulting part". No frame of game time
// separates the press from the reading, and none could: the run was paused before the
// press and a paused run advances no fraction, so a build that raised the fault only
// under later game time would never raise it at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  stepAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports sim.status faulted as soon as the stepped cycle is over", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, [null, "extend"]),
    ]),
    paused: true,
  });
  const piston = (await partIds(h))[0] ?? -1;

  const posed = await h.snapshot();
  assertNotNull(posed.sim, "startRun leaves a live run, held at its settle");
  assertEqual(
    posed.sim?.status,
    "paused",
    "the run stands paused at a boundary, so only a press moves it",
  );

  const clean = await stepAction(h);
  assertEqual(
    clean.sim?.status,
    "paused",
    "the control: the first step runs cycle 0, whose blank cell rests and never faults",
  );
  assertEqual(clean.sim?.cycle, 1, "the first step ran one whole cycle");
  assertNull(
    clean.sim?.fault,
    "the control: no fault stands before the step that raises one",
  );

  const faulted = await stepAction(h);
  await captureStill(h, "faulted");

  assertEqual(
    faulted.sim?.status,
    "faulted",
    "the cycle this step ran extends a piston already at ARM_MAX_LEN, and the fault lands within the step",
  );
  assertEqual(
    faulted.sim?.fault?.kind,
    "overextended",
    "extend on a piston already at ARM_MAX_LEN raises overextended",
  );
  assertDeepEqual(
    faulted.sim?.fault?.parts,
    [piston],
    "a fetch fault names the faulting part",
  );
});
