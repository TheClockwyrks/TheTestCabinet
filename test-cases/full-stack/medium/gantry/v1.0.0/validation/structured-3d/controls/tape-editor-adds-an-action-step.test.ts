// controls/tape-editor-adds-an-action-step — the tape editor appends an action
// step, and the state's program carries it.
//
// `specs/controls.md` § Editing the tape: "what the player can do is fixed: add a
// step, a move or an action; ... Every edit is reflected in the state's program
// (`specs/state.md`)." `specs/instrumentation.md` § The tape gives the pose that
// stands for that edit — "`addActionStep(action)` Appends an action step,
// `"attach"` or `"release"`" — and says these "pose tape edits on the program
// screen, which is where the tape editor lives".
//
// SO THE EDIT IS POSED ON THE PROGRAM SCREEN AND READ BACK OFF THE PROGRAM. The
// tape is emptied first, so the step this validator appends is the whole of what
// the tape holds and its kind and action are read at a known index rather than
// hunted for among a site's authored steps. `attach` rather than `release`
// because the two are one requirement — an action step joins the tape — exercised
// the same way, and `attach` is the action a tape reaches first.
//
// The screen is taken to `program` with `setScreen`, which "shows a named screen
// and sets nothing else", rather than by pressing the `program` action on the
// way: that binding is its own review point.
//
// A frame runs before the reading, because "a build is free to act on an event as
// it arrives or on the frame that reads it" (`specs/instrumentation.md`), so what
// is read is the tape a frame has seen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The action the appended step carries. */
const ACTION = "attach";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends an action step the state's program reports", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("program");
  const empty = await h.snapshot();
  assertEqual(empty.screen, "program", "the screen the tape edit is made on");
  assertLength(empty.program, 0, "the tape the edit is appended to");

  await h.debug.addActionStep(ACTION);
  await h.advance(1);

  const { program } = await h.snapshot();
  assertLength(
    program,
    1,
    `the steps the tape carries after one ${ACTION} step was added ` +
      "(specs/controls.md § Editing the tape)",
  );
  const step = program[0];
  assertEqual(
    step?.kind,
    "action",
    "the kind of the step the editor appended (specs/program.md)",
  );
  assertEqual(
    step?.kind === "action" ? step.action : null,
    ACTION,
    `the action the appended step carries, which is the ${ACTION} the edit ` +
      "asked for (specs/controls.md § Editing the tape)",
  );

  await h.capture("state", "the tape carrying the action step that was added");
});
