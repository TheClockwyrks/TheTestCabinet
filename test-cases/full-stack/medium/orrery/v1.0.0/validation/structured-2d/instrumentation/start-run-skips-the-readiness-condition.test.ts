// instrumentation/start-run-skips-the-readiness-condition — the one thing
// `startRun` deliberately does not do.
//
// THE RULE. "`startRun()` | Runs the game's run-start sequence... The readiness
// condition the `play` action applies is not applied, so a run starts on a machine
// with no rise and no set placed" (`specs/instrumentation.md`, The run).
//
// THE CONDITION IT SKIPS is `specs/editor.md`: "The `play` action starts a run
// when every rise and every set is placed; otherwise it does nothing and the
// heading states which are missing." The challenge posed here carries one reagent
// and one product, so a ready machine would carry one rise and one set; this one
// carries neither, and the check reads the machine back to say so rather than
// assuming it.
//
// AND THE RUN IS RUN, not merely opened. A build that answered a `sim` object and
// then advanced nothing would satisfy "a run started" without having started one,
// so the check hands the machine a whole cycle of game time and reads the cycle
// counter across it: "`sim.cycle` counts completed cycles"
// (`specs/simulation.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, an empty machine, one arm
// with an empty tape — "A blank cell is a rest on every part, a wheel included,
// and never faults" — and the completion switch held off. Nothing on the field can
// fault, spawn, or complete, so the only thing the cycle can do is finish.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  holdCompletion,
  openChallengeDocument,
  partsOfKind,
  placePart,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts and runs a machine with no rise and no set placed", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await holdCompletion(h);
  await placePart(h, "arm", ORIGIN, 0);

  const machine = await h.snapshot();
  assertLength(
    partsOfKind(machine, "rise"),
    0,
    "the machine the run is started on holds no rise",
  );
  assertLength(
    partsOfKind(machine, "set"),
    0,
    "the machine the run is started on holds no set",
  );
  assertEqual(
    machine.challenge?.reagents.length,
    1,
    "the posed challenge has a reagent, so a ready machine would need its rise",
  );
  assertEqual(
    machine.challenge?.products.length,
    1,
    "the posed challenge has a product, so a ready machine would need its set",
  );

  await h.debug.startRun();
  const started = await h.snapshot();
  assertNotNull(
    started.sim,
    "startRun does not apply the readiness condition the play action applies, so the run starts",
  );
  assertEqual(started.sim?.status, "running", "the run opens running");
  assertEqual(started.sim?.cycle, 0, "the run opens on cycle 0");

  await captureReplay(h, "started", () => advanceCycles(h, 1));

  const ran = await h.snapshot();
  assertNotNull(ran.sim, "the run is still live after a whole cycle");
  assertEqual(
    ran.sim?.status,
    "running",
    "a machine resting on a blank tape faults at nothing",
  );
  assertEqual(
    ran.sim?.cycle,
    1,
    "sim.cycle counts completed cycles, so the run really ran",
  );
});
