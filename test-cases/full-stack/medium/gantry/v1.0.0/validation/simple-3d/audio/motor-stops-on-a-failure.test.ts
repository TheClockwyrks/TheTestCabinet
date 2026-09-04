// audio/motor-stops-on-a-failure — a run that fails stops the motor loop.
//
// specs/ui.md § Audio, the `motor` row: it "loops while a run is in progress and
// any axis's rate is nonzero, and is silent otherwise: a run that leaves the
// running phase stops it, whether it cleared, failed, or was aborted, whatever
// rates its axes were left holding".
//
// THE LAST CLAUSE IS THE POINT. A failure stops the run where it stands —
// specs/program.md: "A failed run stays on the run screen with its cause read out
// and the scene as it stood" — so the axis that was driving is left holding its
// rate, and a build whose loop is fed by "an axis's rate is nonzero" alone hums on
// under the failure copy forever. The check reads that rate back at the failing
// tick, so the scenario is the one the clause is about and not merely a run that
// happened to stop moving.
//
// THE FAILURE IS `cable-snap`, reached in the middle of a hoist move: three
// hundred units hung on the hook make the bob's mass `HOOK_MASS` plus three
// hundred, and a bob hanging at rest pulls `m * GRAVITY` (`3050`), past
// `HOIST_CABLE_CAP` (`3000`), which "snaps the cable and ends the run as
// `cable-snap`" (specs/rigging.md). The rigging is stage 4 of the tick and the
// axes move at stage 2 (specs/program.md), so the tick that fails is a tick the
// hoist drove on.
//
// The loop is read from BOTH of the probe's answers, before and after, because a
// build may loop by setting a source's `loop` flag or by re-scheduling the buffer
// end to end (validation/none/cues-init.js).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  addOneLoad,
  createHarness,
  openSite,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/**
 * A hoist move long enough that the axis is still driving when the cable snaps.
 *
 * Appended through the tape editor's own screen, which is where the tape poses
 * apply (specs/instrumentation.md), and left there: `startRun` poses the `run`
 * action, which the program screen carries as well as the build screen.
 */
async function poseTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  await harness.debug.addMoveStep("hoist", 20, HOIST_MAX_RATE);
}

/** Hung on the hook, this pulls the cable past HOIST_CABLE_CAP hanging at rest. */
const LOAD_MASS = 300;

/** Frames watched after the failure, for a loop that re-schedules rather than loops. */
const AFTER_FRAMES = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the motor loop on the tick a run fails, with an axis still driving", async () => {
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared — and `addOneLoad` clears the loads itself.
  await openSite(h, 0);
  await h.debug.clearObstacles();
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    LOAD_MASS,
    { x: 9, y: 2, z: 6, yaw: 0 },
    { x: 9, y: 2, z: 6, yaw: 0 },
  );
  await poseTape(h);
  const opened = await startRun(h);
  assertLength(
    opened.program,
    1,
    "the steps the tape took, so the hoist is driving under the reading",
  );

  await h.cues();
  const driving = await runTicks(h, 5);
  assertTrue(
    driving.run.axes.hoist.rate !== 0,
    "the hoist driving before the failure, so the motor loop is running",
  );
  const sounding = [...(await h.loopingCues()), ...(await h.cues())];
  assertTrue(
    sounding.includes("motor"),
    "the motor loop running before the failure (specs/ui.md), so there is a " +
      "loop for the failure to stop",
  );

  await h.debug.setLoadPhase(0, "attached");
  const failed = await runTicks(h, 1);
  assertEqual(failed.run.phase, "failed", "the run the cable snap ended");
  assertEqual(
    failed.run.cause,
    "cable-snap",
    "the cause the failing tick took",
  );
  assertTrue(
    failed.run.axes.hoist.rate !== 0,
    "the hoist's rate the failed run was left holding, which is the rate the " +
      "loop must stop in spite of (specs/ui.md)",
  );

  await h.cues();
  await h.advance(AFTER_FRAMES);
  const started = await h.cues();
  const looping = await h.loopingCues();

  await h.capture("failed", "The run screen after the failure");

  assertTrue(
    !looping.includes("motor"),
    `no motor loop live over the ${AFTER_FRAMES} frames after the failure: a ` +
      "run that leaves the running phase stops it, whatever rates its axes " +
      "were left holding (specs/ui.md) — the loop is still running",
  );
  assertTrue(
    !started.includes("motor"),
    `no motor sound started over the ${AFTER_FRAMES} frames after the failure ` +
      "(specs/ui.md) — the loop is still being fed",
  );
});
