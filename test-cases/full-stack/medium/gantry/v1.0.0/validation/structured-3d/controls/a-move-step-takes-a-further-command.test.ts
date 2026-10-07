// controls/a-move-step-takes-a-further-command — a move step already commanding
// one axis takes a command on another.
//
// `specs/controls.md` § Editing the tape: what the player can do is "add a step,
// a move or an action; give a move its commands, each an axis, a target, and a
// rate the editor accepts under `specs/program.md`". COMMANDS, plural, on one
// move: `specs/program.md` says a move is "one or more commands, at most one per
// axis" and that "The step's commands run together", which is the whole point of
// a move step and the only way a tape turns and hoists at once.
//
// THE SECOND COMMAND IS ON ANOTHER AXIS, which is the one the editor accepts:
// "at most one per axis", and `specs/instrumentation.md` states the refusal from
// the other side — "A command on an axis its step already commands is refused".
// A second command on the SAME axis is a different item's, and nothing here is
// asserted about it.
//
// THE EDIT IS MADE ON THE PROGRAM SCREEN, "which is where the tape editor lives",
// and the tape is emptied first, so the step the commands are added to is at
// index `0` and is the only one standing. `slew` to `90` at `20` and `hoist` to
// `6` at `3` are both rates greater than `0` and inside their axes' maxima
// (`SLEW_MAX_RATE` `30`, `HOIST_MAX_RATE` `4`), which is what the editor accepts;
// the targets are accepted as written.
//
// THE COMMANDS ARE READ BY AXIS rather than by position: `specs/program.md` fixes
// that a move carries at most one command per axis and never fixes the order they
// are held in, so a build free to hold them either way round is conformant and is
// passed here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The command the step is appended with, and the one added to it. */
const FIRST = { axis: "slew", target: 90, rate: 20 } as const;
const SECOND = { axis: "hoist", target: 6, rate: 3 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries both commands on the one move step", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("program");
  await h.debug.addMoveStep(FIRST.axis, FIRST.target, FIRST.rate);
  assertLength(
    (await h.snapshot()).program,
    1,
    "the move step the further command is added to (specs/program.md)",
  );

  await h.debug.addCommand(0, SECOND.axis, SECOND.target, SECOND.rate);
  await h.advance(1);

  const { program } = await h.snapshot();
  assertLength(
    program,
    1,
    "the steps the tape carries: the two commands are one step",
  );
  const step = program[0];
  assertEqual(step?.kind, "move", "the kind of the step the commands are on");
  if (step?.kind !== "move") return;
  await h.capture(
    "state",
    "The program screen showing one move step on two axes",
  );

  assertLength(
    step.commands,
    2,
    "the commands the move step carries after the second edit " +
      "(specs/controls.md)",
  );
  for (const wanted of [FIRST, SECOND]) {
    const command = step.commands.find((one) => one.axis === wanted.axis);
    assertNotNull(command, `the step's command on the ${wanted.axis} axis`);
    assertEqual(
      command?.target,
      wanted.target,
      `the ${wanted.axis} command's target`,
    );
    assertEqual(
      command?.rate,
      wanted.rate,
      `the ${wanted.axis} command's rate`,
    );
  }
});
