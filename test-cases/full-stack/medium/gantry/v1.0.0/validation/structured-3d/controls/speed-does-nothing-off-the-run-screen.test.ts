// controls/speed-does-nothing-off-the-run-screen — `KeyS` leaves the watch speed
// alone anywhere but the run screen.
//
// `specs/controls.md` § The actions: the `speed` action is bound to `KeyS` and
// does "cycle `RUN_SPEEDS` on the run screen", and the paragraph under the table
// fixes the other half — "Every action applies where the table says and does
// nothing elsewhere." What it would move is `run.speedIndex`, the watch speed "as
// an index into `RUN_SPEEDS`" (`specs/state.md`), which a run starts at `0`.
//
// THE HARDEST VERSION OF THE SCENARIO. A run is started and only then are the
// build and program screens shown, so what refuses the press has to be the
// SCREEN: a build that gated the action on there being a run rather than on the
// screen showing would take it here and fail. Those two are the screens the
// player edits on, and they are where a run cannot be watched — off the run
// screen "nothing ticks" (`specs/instrumentation.md`), so the run stands still
// across both presses and the speed is the only reading that could move.
//
// The tape is one long grip turn, which asks nothing of the structure, and the
// yard is emptied, so nothing can end the run under the presses. This decides one
// direction; that `speed` DOES cycle on the run screen is its own review point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, GRIP_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type Screen,
  type TapeStepSpec,
} from "../harness";

/** The `speed` action's binding, as `specs/controls.md` fixes it. */
const SPEED = BINDINGS.speed[0]!;

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** The screens the action is pressed on, neither of them the run screen. */
const SCREENS: readonly Screen[] = ["build", "program"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the watch speed alone on the build and program screens", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  const started = await startRun(h);
  const speed = started.run.speedIndex;
  assertEqual(speed, 0, "the watch speed a run starts at (specs/state.md)");

  for (const screen of SCREENS) {
    await h.debug.setScreen(screen);
    await h.press(SPEED);
    assertEqual(
      (await h.snapshot()).run.speedIndex,
      speed,
      `run.speedIndex after ${SPEED} on the ${screen} screen, where the speed ` +
        "action does not apply (specs/controls.md)",
    );
  }

  await h.advance(1);
  await h.capture("state", "the watch speed unmoved off the run screen");
});
