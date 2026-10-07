// instrumentation/advance-scales-with-the-watch-speed — a frame covers as many
// ticks as the watch speed says.
//
// A run at watch speed `1` takes one tick of the pipeline `specs/program.md`
// fixes for each frame the game is given, and the watch speed scales that
// exactly as it scales a real frame: "speed changes how many ticks a second of
// watching covers and nothing else", over `RUN_SPEEDS` (`1`, `2`, `4`)
// (`specs/program.md`).
//
// So a frame at `RUN_SPEEDS[i]` covers `RUN_SPEEDS[i]` ticks, and ten frames at
// each of the three speeds in turn cover `10`, `20` and `40` ticks — a running
// total of `10`, `30`, `70`. The check reads the run's own tick counter after
// each block, so it measures the ticks the pipeline ran rather than the frames
// the harness asked for.
//
// The speed is posed through `setSpeedIndex` rather than by pressing `speed`,
// because this decides what a frame covers and not what the key does; the run
// screen is where a started run leaves the check standing, which is where the
// pose applies.
//
// THE TAPE IS ONE LONG GRIP MOVE, so the run is still in progress at the last
// reading, and "Turning the grip applies no force to anything"
// (`specs/rigging.md`), so nothing the crane does can end it early. The yard is
// emptied besides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { GRIP_MAX_RATE, RUN_SPEEDS } from "../constants";
import {
  createHarness,
  openSite,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/**
 * One grip move of a full turn: far longer than the ticks driven below.
 *
 * Appended through the tape editor's own screen, which is where the tape poses
 * apply (`specs/instrumentation.md`), and left there: `startRun` poses the `run`
 * action, which the program screen carries as well as the build screen.
 */
async function poseHoldTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  await harness.debug.addMoveStep("grip", 360, GRIP_MAX_RATE);
}

/** Frames driven at each speed in turn. */
const FRAMES = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("covers as many ticks a frame as the watch speed says", async () => {
  await openSite(h, 0);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await standMinimalCrane(h);
  await poseHoldTape(h);
  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the steps the tape took, so the run keeps ticking under every block",
  );
  assertEqual(
    started.run.speedIndex,
    0,
    "the watch speed a run starts at (specs/state.md)",
  );

  let expected = 0;
  try {
    for (const [index, speed] of RUN_SPEEDS.entries()) {
      if (index > 0) await h.debug.setSpeedIndex(index);

      await h.advance(FRAMES);
      expected += FRAMES * speed;
      // One reading covers both halves: the speed does not move under a block, so
      // the snapshot the block ends on says which speed it ran at as well as what
      // it counted.
      const { run } = await h.snapshot();
      assertEqual(
        run.speedIndex,
        index,
        `the watch speed posed for this block, RUN_SPEEDS[${index}] (${speed})`,
      );
      assertEqual(
        run.tick,
        expected,
        `run.tick after ${FRAMES} frames at speed ${speed}: a frame covers ` +
          `${speed} ticks (specs/instrumentation.md)`,
      );
      assertEqual(
        run.phase,
        "running",
        "the run still in progress, so the count is a driven one",
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("scaled", "The run at the tick three speeds counted to");
  }
});
