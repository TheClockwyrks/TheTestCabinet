// controls/program-key-does-nothing-on-the-run-screen — the `program` action does
// nothing on the run screen.
//
// `specs/controls.md` § The run screen: "The run screen takes the camera actions,
// a pointer drag on the camera, `speed`, `mute`, and `back` alone: the player
// turns the camera and watches rather than steering." § The actions says the same
// of this binding from the other side — `program` (`KeyP`) does "build screen to
// program screen" — and closes with "Every action applies where the table says
// and does nothing elsewhere."
//
// SO THE READING IS THE SCREEN. A build that routes `KeyP` to the program screen
// from wherever it is pressed drops the player out of a run in progress and into
// the tape editor, which is what this separates from a build that leaves the run
// alone.
//
// A REAL RUN, AND ONE THAT CANNOT END UNDER THE PRESS. `startRun` "poses the
// `run` action: the same refusals, the same `run-start`, and the same move to the
// run screen", so the screen the press lands on is the one a player reaches. The
// tape is one long grip turn — `grip` is the hook's yaw, so it asks nothing of
// the structure, and `360` degrees at `GRIP_MAX_RATE` (`45`) is eight seconds of
// run clock against the handful of ticks this press rides on. The world is
// emptied first, so no load and no obstacle can end the run instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The `program` action's binding, as `specs/controls.md` fixes it. */
const PROGRAM = BINDINGS.program[0]!;

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks driven first, so the press lands on a run under way. */
const TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stays on the run screen when the program action is pressed", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const running = await runTicks(h, TICKS);
  assertEqual(running.screen, "run", "the screen the press lands on");
  assertEqual(running.run.phase, "running", "the run the press lands during");

  await h.press(PROGRAM);
  await h.advance(1);

  const after = await h.snapshot();

  await h.capture("state", "the run screen the program action left standing");

  assertEqual(
    after.screen,
    "run",
    `the screen after ${PROGRAM} on the run screen, which takes the camera ` +
      "actions, a pointer drag, `speed`, `mute` and `back` alone " +
      "(specs/controls.md § The run screen)",
  );
});
