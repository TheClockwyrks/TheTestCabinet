// controls/run-key-from-the-program-screen — `KeyG` starts the run from the
// program screen too.
//
// `specs/controls.md` § The actions: the `run` action is bound to `KeyG` and does
// "start the run, from build or program (`specs/program.md`)" — two screens, so
// two requirements, and this is the second. `specs/ui.md` § Program states it of
// the screen: "`build` switches back, `run` starts the run, and `back` returns to
// `select`", and `specs/program.md` fixes what a start does: "A started run plays
// the `run-start` cue, moves to the run screen, and ticks until it ends."
//
// THE SCENARIO IS A CRANE THE START CANNOT REFUSE. Starting "is refused, with the
// issues listed and no run begun, when the structure has a readiness issue
// (`specs/structure.md`) or the tape is empty (`empty-program`)", so a scenario
// about the binding removes both grounds for refusal: the minimal crane carries a
// ring, a valid track and no disconnected member, and the tape is one step.
//
// The program screen is reached with `setScreen`, which "shows a named screen and
// sets nothing else", rather than by pressing the `program` action on the way:
// that binding is its own review point.
//
// The tape is one long grip turn, which asks nothing of the structure, and the
// yard is emptied first, so no load and no obstacle can end the run before it is
// read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The `run` action's binding, as `specs/controls.md` fixes it. */
const RUN_KEY = BINDINGS.run[0]!;

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the run from the program screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await h.debug.setScreen("program");
  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "program",
    "the screen the `run` action is pressed on",
  );
  assertEqual(posed.run.phase, "idle", "the run standing before the press");

  await h.press(RUN_KEY);
  const s = await h.snapshot();
  await h.capture(
    "state",
    "the run the run action started from the program screen",
  );

  assertEqual(
    s.run.phase,
    "running",
    `the run after ${RUN_KEY} on the program screen, which starts the run ` +
      "(specs/program.md)",
  );
  assertEqual(
    s.screen,
    "run",
    "the screen a started run moves to (specs/program.md)",
  );
});
