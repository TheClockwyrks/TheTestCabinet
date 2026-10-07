// controls/speed-key-cycles — `KeyS` on the run screen takes the next watch
// speed and wraps.
//
// `specs/controls.md` § The actions: the `speed` action is bound to `KeyS` and
// does "cycle `RUN_SPEEDS` on the run screen". `specs/ui.md` § Run spells the
// cycle out: "The watch speed, cycled by `speed` through `RUN_SPEEDS`
// (`specs/program.md`): each press takes the next index and wraps from the last
// back to the first, so a run started at index `0` reads `1`, `2`, `4` across
// four presses." `RUN_SPEEDS` is `1`, `2`, `4`, and a run starts at index `0`
// (`specs/state.md`), so three presses read indices `1`, `2`, `0` — the third is
// the wrap.
//
// THE READING IS THE INDEX, NOT THE MULTIPLIER, because that is what the snapshot
// reports: `run.speedIndex`, "the watch speed, as an index into `RUN_SPEEDS`".
// The three presses are one requirement — the cycle — rather than three, and the
// wrap is the reason the third press is here: a build that walked the list and
// stopped at its end passes the first two readings and fails the third.
//
// The run is a real one, started by `startRun`, which "poses the `run` action:
// the same refusals, the same `run-start`, and the same move to the run screen".
// Its tape is one long grip turn, which asks nothing of the structure, and the
// yard is emptied, so nothing can end the run under the presses — and speed
// "changes how many ticks a second of watching covers and nothing else"
// (`specs/program.md`), so the frames these presses ride on cannot change the
// verdict either.

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

/** The indices three presses read, starting from `0`: the last is the wrap. */
const EXPECTED = [1, 2, 0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the next RUN_SPEEDS index on each press and wraps", async () => {
  await openSite(h, 0);
  // The yard is emptied and nothing else is. A site opened after a reset
  // carries an empty structure and an empty tape (specs/state.md), and the
  // crane and the tape below are posed onto them; clearing either again would
  // drive surface this requirement does not concern.
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

  try {
    for (const [press, index] of EXPECTED.entries()) {
      await h.press(SPEED);
      assertEqual(
        (await h.snapshot()).run.speedIndex,
        index,
        `run.speedIndex after press ${press + 1} of ${SPEED}, which takes the ` +
          `next index into RUN_SPEEDS and wraps from the last (specs/ui.md)`,
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("state", "the watch speed wrapped back to the first");
  }
});
