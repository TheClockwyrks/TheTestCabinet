// tape/tape-edits-apply-on-the-program-screen — a tape edit lands on the program
// screen and nowhere else.
//
// `specs/program.md` § The tape: the tape is "an ordered list of steps, edited on
// the program screen". `specs/instrumentation.md` § The tape says the same of the
// poses that stand for those edits — "These pose tape edits on the program
// screen, which is where the tape editor lives" — under the rule every pose is
// held to: "Each pose applies on the screens its section names and does nothing
// on any other, exactly as the control it stands for does."
//
// ONE EDIT, MADE TWICE, is what decides it. The same `addMoveStep` call is made
// on the build screen and then on the program screen, so the two readings differ
// in the screen and in nothing else: a build that applied tape edits everywhere
// appends on the first call, and a build that applied them nowhere appends on
// neither. The tape is emptied first so the count is unambiguous, and the world
// is otherwise bare — this requirement concerns neither the crane nor the yard.
//
// A screen pose is what puts the check on each screen: `setScreen` "shows a named
// screen and sets nothing else", so nothing but the screen differs between the
// two calls. No frame is advanced between them, because a pose "establishes a
// precondition and never an outcome" and what an edit owes is readable at the
// call.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The one edit, made on each screen: a move step carrying one slew command. */
const AXIS = "slew";
const TARGET = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends nothing from the build screen and one step from the program screen", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setScreen("build");
  await h.debug.addMoveStep(AXIS, TARGET, SLEW_MAX_RATE);
  const onBuild = await h.snapshot();

  await h.debug.setScreen("program");
  await h.debug.addMoveStep(AXIS, TARGET, SLEW_MAX_RATE);
  const onProgram = await h.snapshot();

  await h.capture("state", "The tape after the same edit on both screens");

  assertEqual(onBuild.screen, "build", "the screen the first edit was made on");
  assertLength(
    onBuild.program,
    0,
    "the tape after an addMoveStep on the build screen, where a tape edit " +
      "does nothing (specs/instrumentation.md)",
  );
  assertEqual(
    onProgram.screen,
    "program",
    "the screen the second edit was made on",
  );
  assertLength(
    onProgram.program,
    1,
    "the tape after the same addMoveStep on the program screen, where the " +
      "tape editor lives (specs/program.md)",
  );
});
