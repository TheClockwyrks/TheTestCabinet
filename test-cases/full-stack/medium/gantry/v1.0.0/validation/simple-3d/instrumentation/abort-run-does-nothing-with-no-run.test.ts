// instrumentation/abort-run-does-nothing-with-no-run — abortRun outside a run in
// progress changes nothing.
//
// `specs/instrumentation.md` § The run and the screens states it outright:
// "`abortRun` WITH NO RUN IN PROGRESS HAS NO ABORT TO POSE AND DOES NOTHING AT
// ALL: a run already idle stays idle, a run that has ended keeps its phase, its
// cause, its clock and its broken list, and the screen stays exactly where it
// was." That follows from what the pose IS — "`startRun` and `abortRun` do move
// the screen, because each poses a player's ACT rather than a state transition
// … `abortRun` is the abort, and each takes the screen its act takes" — so the
// build screen the operation's own row returns to is the screen the ABORT takes,
// and with nothing to abort there is no act and no screen to take.
//
// The two ways to have no run in progress are the two halves of this check: an
// idle run, and a run that has already ended.
//
// The second half needs a run that has genuinely ended, so the tape's one move
// commands the hoist past `HOIST_MAX` (`40`). `specs/program.md`: "A step whose
// command targets a value outside its axis's range at that moment ends the run as
// `command-out-of-range`", judged when the step starts, so the run's first tick
// ends it — a verdict reached by the game's own rules rather than posed, and one
// that needs no load, no obstacle and no swing to arrive at.
//
// The world holds the minimal crane and nothing else: the yard is emptied first,
// because a load or an obstacle here would be a bystander leaning on rules this
// point is not about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE } from "../constants";
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

/** One move the run cannot take: the hoist target is outside the axis's range. */
const OUT_OF_RANGE_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MAX + 10, rate: HOIST_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the screen and the run as they stand when no run is in progress", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  // With an idle run, on the build screen.
  const idle = await h.snapshot();
  assertEqual(idle.run.phase, "idle", "the run a site opening leaves");
  await h.debug.abortRun();
  const afterIdle = await h.snapshot();
  assertEqual(
    afterIdle.screen,
    "build",
    "the screen abortRun leaves with an idle run",
  );
  assertEqual(
    afterIdle.run.phase,
    "idle",
    "the run abortRun leaves with an idle run",
  );

  // And on a run that has already ended.
  await poseTape(h, OUT_OF_RANGE_TAPE);
  await startRun(h);
  const failed = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    5,
    "the run to end on its out-of-range hoist command",
  );
  assertEqual(
    failed.run.phase,
    "failed",
    "the verdict the out-of-range command reaches (specs/program.md)",
  );

  await h.debug.abortRun();
  const afterEnded = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    afterEnded.screen,
    "run",
    "the screen abortRun leaves on a run that has already ended: with no run " +
      "in progress it has no abort to pose and takes no screen, and a failed " +
      "run stays on the run screen (specs/instrumentation.md, specs/ui.md)",
  );
  assertEqual(
    afterEnded.run.phase,
    "failed",
    "the verdict abortRun leaves on a run that has already ended",
  );
  assertEqual(
    afterEnded.run.cause,
    "command-out-of-range",
    "the cause abortRun leaves on a run that has already ended",
  );
  assertEqual(
    afterEnded.run.tick,
    failed.run.tick,
    "the run clock abortRun leaves on a run that has already ended",
  );
});
