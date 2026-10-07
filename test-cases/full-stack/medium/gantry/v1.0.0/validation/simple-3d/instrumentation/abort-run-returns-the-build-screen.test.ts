// instrumentation/abort-run-returns-the-build-screen — an abort shows the build
// screen again.
//
// `specs/instrumentation.md` § The run and the screens gives `abortRun` as
// "Poses the abort of a run IN PROGRESS, ending it with no verdict: `run` goes
// back to its idle placeholder and the build screen returns", which is the
// surface's half of what `specs/program.md` states for the player: "The `back`
// action aborts a run early and returns to the build screen."
//
// The scenario is a run genuinely in progress, since that is the only state the
// pose applies in: the minimal crane on an emptied yard and a tape that moves one
// axis a short way, aborted a few ticks in — a two-unit hoist move at
// `HOIST_ACCEL` (`6`) takes some seventy ticks, so five is barely into it and the
// run is unmistakably still running when the abort lands rather than having ended
// on its own. Only the screen is read: what the abort leaves in `run` is its own
// point, and the ticks driven are the ones that reading needs and no more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A move long enough that the ticks below land well inside it. */
const SHORT_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

const TICKS = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the build screen when a run in progress is aborted", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, SHORT_TAPE);
  await startRun(h);

  const running = await runTicks(h, TICKS);
  assertEqual(
    running.run.phase,
    "running",
    `the run after ${TICKS} ticks, which is what abortRun applies to`,
  );

  await h.debug.abortRun();
  const aborted = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    aborted.screen,
    "build",
    "the screen abortRun returns to (specs/instrumentation.md)",
  );
});
