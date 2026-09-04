// instrumentation/set-speed-index-off-the-run-screen-does-nothing — the pose
// changes nothing on the build and program screens.
//
// `specs/instrumentation.md` § The run in progress: "`setSpeedIndex` poses the
// watch speed on the run screen, as the `speed` action does". The action it
// stands for is bound to one screen — `speed`, `KeyS`, "cycle `RUN_SPEEDS` on
// the run screen" (`specs/controls.md`) — and "Every action applies where the
// table says and does nothing elsewhere". The surface carries the same rule for
// every pose: "Each pose applies on the screens its section names and does
// nothing on any other, exactly as the control it stands for does"
// (§ The operations).
//
// THE HARDEST VERSION OF THE SCENARIO. A run is started and then the build and
// the program screens are shown while it is still in progress, so what refuses
// the pose has to be the SCREEN: a build that gated the pose on there being a
// run rather than on the screen showing would take it here and fail. The two
// screens are the two the surface's own site and structure poses live on, which
// is where a scenario is standing when it poses a world, and the index posed is
// one neither `RUN_SPEEDS` index the run holds — a run starts at index `0`
// (`specs/state.md`).
//
// This decides only that direction. That the pose DOES take on the run screen is
// its own requirement next door, so a build that never took it fails there.

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
  type TapeStepSpec,
} from "../harness";

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

it("leaves the watch speed alone on the build and program screens", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  const started = await startRun(h);
  const speed = started.run.speedIndex;
  assertEqual(speed, 0, "the watch speed a run starts at (specs/state.md)");

  for (const [screen, index] of CASES) {
    await h.debug.setScreen(screen);
    await h.debug.setSpeedIndex(index);
    assertEqual(
      (await h.snapshot()).run.speedIndex,
      speed,
      `run.speedIndex after setSpeedIndex(${index}) on the ${screen} screen, ` +
        "where the speed action does nothing (specs/instrumentation.md)",
    );
  }

  await h.capture("elsewhere", "The watch speed unmoved off the run screen");
});
