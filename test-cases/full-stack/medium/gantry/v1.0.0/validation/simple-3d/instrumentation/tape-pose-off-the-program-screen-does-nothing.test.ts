// instrumentation/tape-pose-off-the-program-screen-does-nothing — the five tape
// poses change nothing on any screen but `program`.
//
// `specs/instrumentation.md` § The tape, of `clearProgram`, `addMoveStep`,
// `addCommand`, `addActionStep` and `removeStep`: "These pose tape edits on the
// program screen, which is where the tape editor lives (`specs/controls.md`)."
// The surface's general rule says what that means for every other screen: "Each
// pose applies on the screens its section names and does nothing on any other,
// exactly as the control it stands for does" (§ The operations). And the control
// they stand for is bound to that screen alone — "The program screen edits the
// tape with the pointer and the menu actions" (`specs/controls.md`).
//
// SO EVERY OTHER SCREEN IS TRIED, and all five poses on each: `build`, `run`,
// `title`, `select`, `howto` and `results` are the six the seven screens leave
// when `program` is taken out (`specs/ui.md`). Each pose is one a build standing
// on the program screen would ACCEPT — a move step, a second command on a step
// that does not yet carry that axis, an action step, a removal of a step the
// tape carries, and the emptying — so nothing here is refused for a reason of
// its own, and the whole tape is read back after each screen's five and compared
// to the one that was posed.
//
// `setScreen` is what moves between them, because it "shows a named screen and
// sets nothing else": a check that pressed its way around would be grading the
// screen actions as well.
//
// This decides that direction alone. That the five poses DO take on the program
// screen is what the checks for each of them decide, next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, SLEW_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type Screen,
  type TapeStepSpec,
} from "../harness";

/** The tape the poses are tried against: one move step, and one action step. */
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

it("leaves the tape alone on every screen but the program screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const posed = JSON.stringify((await h.snapshot()).program);

  for (const screen of ELSEWHERE) {
    await h.debug.setScreen(screen);
    // Five poses the program screen would take: an appended move, a second
    // command on the move step at 0 (which commands the hoist and not the
    // trolley), an appended action, the removal of a step the tape carries, and
    // the emptying.
    await h.debug.addMoveStep("slew", 90, SLEW_MAX_RATE);
    await h.debug.addCommand(0, "trolley", 2, TROLLEY_MAX_RATE);
    await h.debug.addActionStep("release");
    await h.debug.removeStep(0);
    await h.debug.clearProgram();

    assertEqual(
      JSON.stringify((await h.snapshot()).program),
      posed,
      `the tape after the five tape poses on the ${screen} screen, where the ` +
        "tape editor does not live (specs/instrumentation.md)",
    );
  }

  await h.capture(
    "untouched",
    "The tape the poses off the program screen left",
  );
});
