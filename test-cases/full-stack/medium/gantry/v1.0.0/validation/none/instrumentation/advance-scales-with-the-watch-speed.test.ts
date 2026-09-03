// instrumentation/advance-scales-with-the-watch-speed — a frame covers as many
// ticks as the watch speed says.
//
// `specs/instrumentation.md` § The clock: "During a run at watch speed `1` a
// frame covers exactly one tick of the pipeline `specs/program.md` fixes, so
// `advance(n)` runs `n` ticks. The watch speed scales what a frame covers
// exactly as it scales a real frame, so a scenario counting ticks leaves the
// speed where a run starts it." `specs/program.md` says the same from the
// player's side: "speed changes how many ticks a second of watching covers and
// nothing else", over `RUN_SPEEDS` (`1`, `2`, `4`).
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
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE, RUN_SPEEDS } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One grip move of a full turn: far longer than the ticks driven below. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

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
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  const started = await startRun(h);
  assertEqual(
    started.run.speedIndex,
    0,
    "the watch speed a run starts at (specs/state.md)",
  );

  let expected = 0;
  for (const [index, speed] of RUN_SPEEDS.entries()) {
    if (index > 0) await h.debug.setSpeedIndex(index);
    assertEqual(
      (await h.snapshot()).run.speedIndex,
      index,
      `the watch speed posed for this block, RUN_SPEEDS[${index}] (${speed})`,
    );

    await h.advance(FRAMES);
    expected += FRAMES * speed;
    const { run } = await h.snapshot();
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

  await h.capture("scaled", "The run at the tick three speeds counted to");
});
