// instrumentation/set-speed-index-off-the-run-screen-does-nothing — the pose
// reaches the watch speed from the build and program screens too.
//
// `specs/instrumentation.md` § The run in progress: "`setSpeedIndex` poses the
// watch speed, as the `speed` action does, wherever the game stands and whether
// or not a run that screen is showing has ended." The surface's general rule is
// what puts it there: "No operation asks which screen is showing, whether a run
// is in progress, or which tool is selected. Those are how a player reaches a
// control and are not an operation's conditions" (§ The operations).
//
// THE HARDEST VERSION OF THE SCENARIO. A run is started and then the build and
// the program screens are shown while it is still in progress, so a build that
// gated the pose on the run SCREEN — as the `speed` ACTION is gated
// (`specs/controls.md`), which is exactly the reach rule B removes — leaves the
// speed where it was and fails here. The two screens are the two the surface's
// own site and structure poses live on, which is where a scenario is standing
// when it poses a world.
//
// THE ACTION'S OWN SCREEN GATE IS UNTOUCHED, and is decided by
// `controls/speed-does-nothing-off-the-run-screen` next door: a KEY press is the
// player's route and is still bound to the run screen. What this decides is that
// the debug operation is not a player.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type Screen,
} from "../harness";
import type { TapeStepSpec } from "../harness";

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** The screens the requirement names, and the index posed on each. */
const CASES: readonly (readonly [Screen, number])[] = [
  ["build", 2],
  ["program", 1],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the watch speed from the build and program screens", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  const started = await startRun(h);
  assertEqual(
    started.run.speedIndex,
    0,
    "the watch speed a run starts at (specs/state.md)",
  );

  try {
    for (const [screen, index] of CASES) {
      await h.debug.setScreen(screen);
      await h.debug.setSpeedIndex(index);
      await h.debug.reconcile();
      assertEqual(
        (await h.snapshot()).run.speedIndex,
        index,
        `run.speedIndex after setSpeedIndex(${index}) on the ${screen} ` +
          "screen: the screen is a player's route to the speed action and not " +
          "the operation's condition (specs/instrumentation.md)",
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("elsewhere", "The watch speed posed off the run screen");
  }
});
