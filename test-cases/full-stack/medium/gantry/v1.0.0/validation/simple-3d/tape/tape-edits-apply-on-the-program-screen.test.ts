// tape/tape-edits-apply-on-the-program-screen — the same tape edit appends one
// step on the program screen, and on the build screen too.
//
// `specs/controls.md` § Editing the tape: "The program screen edits the tape with
// the pointer and the menu actions", which is where a PLAYER reaches the editor.
// `specs/instrumentation.md` § The tape says what that means for the operations:
// they "pose tape edits on the open site's tape, wherever the game stands — the
// program screen is how a player reaches the tape editor (`specs/controls.md`)
// and is not a condition on these".
//
// SO THE SAME CALL IS MADE FROM BOTH SCREENS AND MUST LAND BOTH TIMES. Reading it
// from the program screen alone would not separate a build that edits the tape
// from one that never edits it, and reading it from the build screen alone would
// not separate a build that edits the tape from one whose `addMoveStep` writes
// somewhere else entirely. The tape is counted after each, so the two steps that
// stand at the end are one per call.
//
// THE EDIT IS ONE THE EDITOR'S OWN RULES TAKE — `slew` at `SLEW_MAX_RATE` on a
// step that carries one command (`specs/program.md`) — because what rule B
// removes is the reach and not the editor's rules, which the
// `tape/tape-editor-refuses-*` points decide next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The command each edit carries: one the tape editor's own rules accept. */
const AXIS = "slew";
const TARGET = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends one step from the build screen and one from the program screen", async () => {
  await openSite(h, 0);
  // The one precondition this requirement has: an empty tape to count against.
  await h.debug.clearProgram();

  await h.debug.setScreen("build");
  await h.debug.addMoveStep(AXIS, TARGET, SLEW_MAX_RATE);
  await h.debug.reconcile();
  const onBuild = await h.snapshot();

  await h.debug.setScreen("program");
  await h.debug.addMoveStep(AXIS, TARGET, SLEW_MAX_RATE);
  await h.debug.reconcile();
  const onProgram = await h.snapshot();

  await h.capture("state", "The tape after the same edit on both screens");

  assertEqual(onBuild.screen, "build", "the screen the first edit was made on");
  assertLength(
    onBuild.program,
    1,
    "the tape after an addMoveStep on the build screen, which is a player's " +
      "route to the tape editor and not the operation's condition " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    onProgram.screen,
    "program",
    "the screen the second edit was made on",
  );
  assertLength(
    onProgram.program,
    2,
    "the tape after the same addMoveStep on the program screen, where the " +
      "tape editor lives (specs/program.md)",
  );
});
