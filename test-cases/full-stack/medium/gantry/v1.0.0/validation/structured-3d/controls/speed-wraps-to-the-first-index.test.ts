// controls/speed-wraps-to-the-first-index — a fourth `speed` press wraps back to
// the first watch speed.
//
// `specs/ui.md` § Run: "The watch speed, cycled by `speed` through `RUN_SPEEDS`
// (`specs/program.md`): each press takes the next index and wraps from the last
// back to the first, so a run started at index `0` reads `1`, `2`, `4`, `1`
// across four presses." `RUN_SPEEDS` is `1`, `2`, `4`, and a run "starts at speed
// index `0`" (`specs/state.md`), so four presses read indices `1`, `2`, `0`, `1`.
//
// THE FOURTH PRESS IS THE ONE THIS DECIDES, and it is why four are pressed rather
// than three: the third press is the wrap, and the fourth is what says the wrap
// left the cycle running rather than parked. A build that wrapped once and then
// stuck at `0`, and a build that treated the wrap as a reset and started counting
// again from somewhere else, both read the first three presses correctly and the
// fourth wrongly. The four presses are one requirement — the cycle wraps and goes
// on — read in one direction.
//
// THE READING IS THE INDEX, because that is what the snapshot reports:
// `run.speedIndex`, an index into `RUN_SPEEDS`. What the run screen DRAWS beside
// it is `RUN_SPEEDS[speedIndex]` and is a picture rather than a reading, so it is
// captured as this item's evidence rather than asserted.
//
// The run is a real one, started by `startRun`. Its tape is one long grip turn,
// which asks nothing of the structure, and the yard is emptied, so nothing can
// end the run under the presses — and speed "changes how many ticks a second of
// watching covers and nothing else" (`specs/program.md`), so the frames these
// presses ride on cannot change the verdict either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, GRIP_MAX_RATE, RUN_SPEEDS } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
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

/** The indices four presses read from `0`: the third wraps, the fourth goes on. */
const EXPECTED = [1, 2, 0, 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps to the first watch speed and carries the cycle on", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  const started = await startRun(h);
  assertEqual(started.screen, "run", "the screen the presses land on");
  assertEqual(
    started.run.speedIndex,
    0,
    "the watch speed a run starts at (specs/state.md)",
  );
  assertEqual(RUN_SPEEDS.length, 3, "the watch speeds the cycle runs through");

  for (const [press, index] of EXPECTED.entries()) {
    await h.press(SPEED);
    const s = await h.snapshot();
    assertEqual(
      s.run.speedIndex,
      index,
      `run.speedIndex after press ${press + 1} of ${SPEED}, which takes the ` +
        "next index into RUN_SPEEDS and wraps from the last back to the " +
        `first, reading ${RUN_SPEEDS[index]} times real time ` +
        "(specs/ui.md § Run)",
    );
    if (index === 0) {
      await h.capture("wrapped", "The run screen after the wrapping press");
    }
  }
});
