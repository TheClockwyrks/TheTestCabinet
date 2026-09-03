// instrumentation/set-speed-index-after-a-run-ends — the watch speed is posable
// on the run screen after the run it is showing has ended.
//
// `specs/instrumentation.md` § The run in progress: "`setSpeedIndex` poses the
// watch speed on the run screen, as the `speed` action does, whether or not the
// run that screen is showing has ended." The first six run poses are the ones
// that need a run in progress — "The first six pose the run while one is in
// progress" — and `setSpeedIndex` is deliberately held apart from them, because
// what it poses belongs to the screen rather than to the simulation: a failed
// run "stays on the run screen with its cause read out and the scene as it
// stood" (`specs/program.md`), and the player can still cycle the speed there.
//
// SO THE RUN IS DRIVEN TO A FAILURE FIRST, and reached directly: a tape holding
// one `release` action over an empty yard fails on the tick that takes it, since
// "`release` with nothing attached ends the run the same way" —
// `release-misplaced` (`specs/rigging.md`). One step, one tick, no reliance on
// any physics the requirement is not about.
//
// The check then poses index `2` — the last of `RUN_SPEEDS` (`1`, `2`, `4`), and
// not the `0` a run starts at (`specs/state.md`) — and reads it back, with the
// run's verdict still standing, which is what "whether or not the run has ended"
// asks for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { RUN_SPEEDS } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One release over an empty hook: the run fails on the tick that takes it. */
const RELEASE_TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "release" },
];

/** The last of RUN_SPEEDS, and not the index a run starts at. */
const INDEX = RUN_SPEEDS.length - 1;

/** How long the one-step tape is given to reach its verdict. */
const CAP = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the watch speed on the run screen after the run has ended", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, RELEASE_TAPE);
  await startRun(h);

  const ended = await runUntil(
    h,
    (s) => s.run.phase === "failed",
    CAP,
    "the run to end on its release over an empty hook (specs/rigging.md)",
  );
  assertEqual(
    ended.screen,
    "run",
    "the screen a failed run stays on (specs/ui.md), which is where " +
      "setSpeedIndex applies",
  );

  await h.debug.setSpeedIndex(INDEX);
  const { run } = await h.snapshot();

  await h.capture("speed", "The watch speed posed on an ended run");

  assertEqual(
    run.speedIndex,
    INDEX,
    "run.speedIndex after setSpeedIndex on a run that has ended " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    run.phase,
    "failed",
    "the run's phase across the pose: it stays as it ended",
  );
  assertEqual(
    run.cause,
    "release-misplaced",
    "the run's cause across the pose: it stays as it ended",
  );
});
