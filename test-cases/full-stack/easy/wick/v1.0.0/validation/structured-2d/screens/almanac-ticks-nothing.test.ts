// Wick — screens/almanac-ticks-nothing: the almanac advances nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "What advances on
// each screen", gives the row "`title`, `howto`, `almanac` | Nothing of the
// run. `simTime` still rises, and the almanac's entry picture animates off
// it." The almanac's own section says the same: "The almanac holds the idle
// run, nothing advances while it is open", with its entry picture named there
// as the exception. THE RUN is what this point reads, and the exception is the
// picture rather than the run: what animates off `simTime` is read by
// screens/almanac-draws-enemy-animation instead.
//
// WHAT IS READ. `run.tick` after each of sixty frames — one second of frames
// at the `TICK_HZ` (`60`) `specs/overview.md` fixes, long enough that a build
// that ticked the simulation on this screen has consumed sixty ticks — and the
// whole `run` at the end, against the idle run of `specs/state.md` the screen
// arrived with. The run is compared as a whole, so a build that advanced a
// spawn timer, a cooldown, or the clock while nothing else moved is caught by
// the same reading.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it with "the idle run" (`specs/instrumentation.md`), and sixty
// frames of the harness's own clock, each worth one tick on `playing`. Nothing
// is pressed.
//
// THE TOLERANCE. None: a tick count of `0` on every frame, and an exact run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";

/** Frames of the almanac run: one second at TICK_HZ. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds run.tick at 0 and the idle run over sixty frames", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the frames are run on");
  assertDeepEqual(opened.run, IDLE_RUN, "the run the almanac is entered with");

  const ticks: number[] = [];
  for (let frame = 0; frame < FRAMES; frame += 1) {
    await h.advance(1);
    ticks.push(h.snapshot().run.tick);
  }
  captureStill(h, "still");

  assertEqual(
    ticks.filter((tick) => tick !== 0).length,
    0,
    `frames of the almanac on which run.tick had left 0, of ${FRAMES} (specs/ui.md, What advances on each screen)`,
  );
  const after = h.snapshot();
  assertEqual(after.screen, "almanac", "the screen after the frames");
  assertDeepEqual(
    after.run,
    IDLE_RUN,
    `the run after ${FRAMES} frames of the almanac (specs/ui.md, almanac)`,
  );
});
