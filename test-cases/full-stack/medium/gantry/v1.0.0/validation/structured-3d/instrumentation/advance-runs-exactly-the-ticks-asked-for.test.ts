// instrumentation/advance-runs-exactly-the-ticks-asked-for — a frame advance
// runs the whole frames it was asked for, and no others.
//
// `specs/instrumentation.md` § The clock: "`advance(ticks)` | Runs `ticks` whole
// frames, immediately and in order", and "During a run at watch speed `1` a
// frame covers exactly one tick of the pipeline `specs/program.md` fixes, so
// `advance(n)` runs `n` ticks." A run's tick count is what the pipeline
// increments — "A tick that ends the run counts like any other" — and the
// snapshot reports it as `run.tick`, so the run's own counter is the ruler.
//
// EVERY SCENARIO IN THIS PROJECT RESTS ON THIS. A check that drives forty ticks
// and reads a force is measuring the build's simulation only if forty ticks is
// what it drove, so the count is checked at three sizes and cumulatively: one
// frame, a handful, and more than a hundred, each read straight after the call
// it made. A build that ran an extra frame, dropped one, or coalesced a request
// into a single step fails on the first size that catches it.
//
// The watch speed is left where the run starts it — index `0`, `RUN_SPEEDS[0]`
// (`1`) (`specs/state.md`) — because "The watch speed scales what a frame covers
// exactly as it scales a real frame, so a scenario counting ticks leaves the
// speed where a run starts it". What a speed above `1` does is its own
// requirement next door.
//
// THE TAPE IS ONE LONG GRIP MOVE, so the run is still in progress at the last
// reading: a run that ended would stop counting and the check would be reading
// an ended run rather than a driven one. "Turning the grip applies no force to
// anything" (`specs/rigging.md`), so nothing the crane does can end the run
// early, and the world is emptied of loads and obstacles besides.

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

/**
 * One grip move of a full turn: at `GRIP_MAX_RATE` (`45` deg/s) that is over
 * eight run seconds of live step, far past the ticks this check drives.
 */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** The sizes driven, in order: one frame, a handful, and a long block. */
const BLOCKS = [1, 7, 120] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs exactly the ticks it is asked for, in order", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  const started = await startRun(h);
  assertEqual(
    started.run.tick,
    0,
    "run.tick immediately after the start: nothing has ticked at the call " +
      "(specs/state.md)",
  );
  assertEqual(
    started.run.speedIndex,
    0,
    `the watch speed a run starts at, RUN_SPEEDS[0] (${RUN_SPEEDS[0]}), which ` +
      "is the speed a frame covers one tick at (specs/instrumentation.md)",
  );

  let expected = 0;
  for (const block of BLOCKS) {
    await h.advance(block);
    expected += block;
    const { run } = await h.snapshot();
    assertEqual(
      run.tick,
      expected,
      `run.tick after advance(${block}), the ${expected}th tick of the run ` +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      run.phase,
      "running",
      "the run still in progress, so run.tick is a driven count rather than " +
        "the count an ended run stopped at",
    );
  }

  await h.capture("ticks", "The run at the tick the advances counted to");
});
