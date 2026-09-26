// tape/tape-editor-refuses-command-on-an-action — a command added to an action
// step is refused.
//
// `specs/instrumentation.md` § The tape, on the rules every tape pose passes:
// "A command on an axis its step already commands is refused, as is a command
// added to an action step." `specs/program.md` says the same from the tape's
// side — a step is a move OR an action, and only a move carries commands.
//
// THE REFUSAL IS SILENT, so what decides this is the step afterwards: "The
// refusal is silent and readable in the snapshot: no member appears, no cost is
// spent, no step joins the tape". The tape holds one `attach` step, the command
// is offered to it at its own index, and the step is read back — it is still an
// action step carrying `attach`, and the tape is still one step long. A build
// that let the command through has either turned the step into a move or hung a
// command off an action, and either reads differently here.
//
// The edit is made on the program screen, where the tape editor lives, so the
// refusal under test is the one this point is about rather than the screen rule
// (which is its own point). The world is otherwise empty: this requirement
// concerns the editor and never a run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The tape the command is offered to: one action step. */
const TAPE: readonly TapeStepSpec[] = [{ kind: "action", action: "attach" }];

/** The command offered to it, well inside the hoist's range and rate. */
const TARGET = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves an action step an action step when a command is added to it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("program");
  await poseTape(h, TAPE);

  await h.debug.addCommand(0, "hoist", TARGET, HOIST_MAX_RATE);
  const after = await h.snapshot();

  await h.capture("state", "The action step the command was offered to");

  assertLength(
    after.program,
    1,
    "the steps the tape holds after a command was added to its action step " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.program[0]?.kind,
    "action",
    "the kind of the step the command was added to, which the refusal leaves " +
      "as it was (specs/instrumentation.md)",
  );
  assertEqual(
    after.program[0]?.kind === "action" ? after.program[0].action : null,
    "attach",
    "the action that step carries (specs/program.md)",
  );
});
