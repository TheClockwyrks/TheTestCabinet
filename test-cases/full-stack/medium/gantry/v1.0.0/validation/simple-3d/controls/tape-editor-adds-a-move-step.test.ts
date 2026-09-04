// controls/tape-editor-adds-a-move-step — a move step joins the tape carrying the
// command it was given.
//
// `specs/controls.md` § Editing the tape: "The exact widgets are the build's
// design; what the player can do is fixed: add a step, a move or an action; give
// a move its commands, each an axis, a target, and a rate the editor accepts
// under `specs/program.md` ... Every edit is reflected in the state's program."
// The widgets being the build's design is why this is read through the tape pose
// rather than through the program screen's pointer: `addMoveStep(axis, target,
// rate)` "Appends a move step carrying one command: drive `axis` to `target` at
// `rate`" (`specs/instrumentation.md`), which is the player's own edit posed, and
// the reading is the tape the state reports.
//
// `specs/program.md` says what a move step is: "A move: one or more commands, at
// most one per axis. A command is `{ axis, target, rate }`: drive that axis to
// the absolute `target` at up to `rate`." So the reading is the step's kind and
// its one command, axis, target, and rate.
//
// THE EDIT IS MADE ON THE PROGRAM SCREEN, "which is where the tape editor lives",
// and the tape is emptied first so the step this edit appends is the only one
// standing. The command is `slew` to `90` at `20`: a rate greater than `0` and
// inside `SLEW_MAX_RATE` (`30`), which is what the editor accepts, and a target
// accepted as written since "whether a target is reachable depends on the
// structure, so it is judged when the step starts".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The one command the appended step carries. */
const AXIS = "slew";
const TARGET = 90;
const RATE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends a move step carrying the command it was given", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("program");
  assertLength((await h.snapshot()).program, 0, "the tape the edit is made on");

  await h.debug.addMoveStep(AXIS, TARGET, RATE);
  await h.advance(1);

  const { program } = await h.snapshot();
  assertLength(program, 1, "the steps the tape carries after one edit");
  const step = program[0];
  assertEqual(step?.kind, "move", "the kind of step addMoveStep appends");
  if (step?.kind !== "move") return;
  assertLength(
    step.commands,
    1,
    "the commands the appended move step carries (specs/instrumentation.md)",
  );
  assertEqual(step.commands[0]?.axis, AXIS, "the command's axis");
  assertEqual(step.commands[0]?.target, TARGET, "the command's target");
  assertEqual(step.commands[0]?.rate, RATE, "the command's rate");

  await h.capture("state", "The program screen showing the one move step");
});
