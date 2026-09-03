// controls/run-key-does-nothing-on-the-run-screen — the `run` action does not
// start a second run from the run screen.
//
// `specs/controls.md` § The run screen: "The run screen takes the camera actions,
// a pointer drag on the camera, `speed`, `mute`, and `back` alone: the player
// turns the camera and watches rather than steering." § The actions binds `run`
// to `KeyG` and gives it "start the run, from build or program
// (`specs/program.md`)" — those two screens and no other — and
// `specs/program.md` § Starting and ending a run says the same: "A run starts
// from the build or program screen through the `run` action."
//
// SO THE READING IS THE RUN CLOCK. `specs/state.md` fixes what a start leaves —
// "nothing has ticked at the call, so `run.tick` reads `0` immediately after it"
// — so a build that restarts the run under this press throws the tick count back
// to the ticks that have run since, while a build that ignores the press carries
// the run it was already watching. The count is exact: `TICKS` ticks are driven
// before the press, the press itself holds the key across one tick, and one more
// frame runs after it, so a run left alone stands at `TICKS + 2`. A run at the
// watch speed it starts at (`RUN_SPEEDS[0]`, `1`) covers one tick a frame, and
// nothing here poses the speed.
//
// A REAL RUN, AND ONE THAT CANNOT END UNDER THE PRESS. `startRun` "poses the
// `run` action: the same refusals, the same `run-start`, and the same move to the
// run screen". The tape is one long grip turn — `grip` is the hook's yaw, so it
// asks nothing of the structure, and `360` degrees at `GRIP_MAX_RATE` (`45`) is
// eight seconds of run clock against the handful of ticks this press rides on.
// The world is emptied first, so no load and no obstacle can end the run instead.

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

/** The `run` action's binding, as `specs/controls.md` fixes it. */
const RUN = BINDINGS.run[0]!;

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks driven first, so the press lands on a run under way. */
const TICKS = 10;

/** The ticks the press itself rides on: one inside it, one after it. */
const PRESS_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the run it was watching on when the run action is pressed", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const running = await runTicks(h, TICKS);
  assertEqual(running.screen, "run", "the screen the press lands on");
  assertEqual(running.run.phase, "running", "the run the press lands during");
  assertEqual(running.run.tick, TICKS, "the ticks run before the press");

  await h.press(RUN);
  await h.advance(1);

  const after = await h.snapshot();
  assertEqual(
    after.run.tick,
    TICKS + PRESS_TICKS,
    `run.tick after ${RUN} on the run screen: the \`run\` action starts a run ` +
      "from the build or program screen alone, so the run under way carries " +
      "on rather than starting again at tick 0 " +
      "(specs/controls.md § The run screen, specs/program.md)",
  );
  assertEqual(
    after.run.phase,
    "running",
    "the run's phase across the press: nothing began and nothing ended",
  );

  await h.capture("state", "the run the run action left running on");
});
