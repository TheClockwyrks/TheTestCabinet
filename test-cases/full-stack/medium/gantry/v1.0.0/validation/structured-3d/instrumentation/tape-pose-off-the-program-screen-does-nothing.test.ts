// instrumentation/tape-pose-off-the-program-screen-does-nothing — the five tape
// poses reach the open site's tape from every screen.
//
// `specs/instrumentation.md` § The tape, of `clearProgram`, `addMoveStep`,
// `addCommand`, `addActionStep` and `removeStep`: "These pose tape edits on the
// open site's tape, wherever the game stands — the program screen is how a player
// reaches the tape editor (`specs/controls.md`) and is not a condition on these".
// The surface's general rule says the same of every operation: "No operation asks
// which screen is showing … a tape pose edits its tape with the build screen up"
// (§ The operations).
//
// SO EVERY OTHER SCREEN IS TRIED, and all five poses on each: `build`, `run`,
// `title`, `select`, `howto` and `results` are the six the seven screens leave
// when `program` is taken out (`specs/ui.md`). Each pose is one the tape editor's
// OWN rules take — a move step, a second command on a step that does not yet
// carry that axis, an action step, a removal of a step the tape carries, and the
// emptying — because what rule B removes is the reach and not the editor's rules,
// which are the edit rather than a gate on reaching it.
//
// `setScreen` is what moves between them, because it "shows a named screen and
// sets nothing else": a check that pressed its way around would be grading the
// screen actions as well. Nothing is built, for the same reason: the tape poses
// are all this decides, `setScreen` shows the run and results screens whether or
// not a crane stands, and a build whose member placement is broken must fail the
// editor's points rather than this one.
//
// That the editor's own rules still refuse what they refused is decided by the
// `tape/tape-editor-refuses-*` points next door, which this leaves untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, SLEW_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type Screen,
  type TapeStepSpec,
} from "../harness";

/** The tape each pass starts from: one move step, and one action step. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 4, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
];

/** The six screens the tape editor does not live on (`specs/ui.md`). */
const ELSEWHERE: readonly Screen[] = [
  "build",
  "run",
  "title",
  "select",
  "howto",
  "results",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("edits the open site's tape from every screen", async () => {
  await openSite(h, 0);
  await clearAll(h);

  try {
    for (const screen of ELSEWHERE) {
      await h.debug.setScreen(screen);
      await h.debug.clearProgram();
      await poseTape(h, TAPE);
      await h.debug.setScreen(screen);

      // Five poses the tape editor's own rules take: an appended move, a second
      // command on the move step at 0 (which commands the hoist and not the
      // trolley), an appended action, and the removal of a step the tape carries.
      await h.debug.addMoveStep("slew", 90, SLEW_MAX_RATE);
      await h.debug.addCommand(0, "trolley", 2, TROLLEY_MAX_RATE);
      await h.debug.addActionStep("release");
      await h.debug.removeStep(0);
      await h.debug.reconcile();

      const after = await h.snapshot();
      assertLength(
        after.program,
        3,
        `the steps the tape holds after the four appends and the removal on ` +
          `the ${screen} screen, which is a player's route to the tape editor ` +
          "and not the operation's condition (specs/instrumentation.md)",
      );

      await h.debug.clearProgram();
      await h.debug.reconcile();
      assertLength(
        (await h.snapshot()).program,
        0,
        `the tape clearProgram emptied from the ${screen} screen ` +
          "(specs/instrumentation.md)",
      );
    }

    // The picture: the tape a pose made from the results screen left standing.
    await h.debug.setScreen("results");
    await h.debug.addActionStep("attach");
    await h.debug.reconcile();
    assertEqual(
      (await h.snapshot()).program[0]?.kind,
      "action",
      "the step addActionStep appended from the results screen " +
        "(specs/instrumentation.md)",
    );
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("untouched", "The tape a pose reached from every screen");
  }
});
