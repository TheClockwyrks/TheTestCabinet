// run — a failed run stays on the run screen.
//
// `specs/ui.md` § Run: "A cleared run moves to `results`. A failed run stays
// here, the scene as it stood, with the failure copy below shown plainly."
// `specs/program.md` says the same from the other side: "A failed run stays on
// the run screen with its cause read out and the scene as it stood, so the
// player reads what went wrong before going back to edit."
//
// This check decides that one requirement: after a run fails, the run screen is
// still the screen showing, and it stays showing. The failure copy itself, and
// the scene standing as it stood, are their own points.
//
// THE FAILURE IS THE CHEAPEST AND MOST ISOLATED ONE THE SPECIFICATION OFFERS. The
// tape's only step commands the hoist to a value past `HOIST_MAX`, and
// `specs/program.md` fixes what that does: "A step whose command targets a value
// outside its axis's range at that moment ends the run as
// `command-out-of-range`." Taking a step is stage 1 of the tick pipeline, ahead of
// the rigging, the collisions and the solves, and "the first failure a tick
// reaches ends the run with that cause" — so the verdict is reached before
// anything about the crane or the yard is looked at.
//
// THE CRANE IS THEREFORE THE SMALLEST STRUCTURE A RUN STARTS ON: the ring and one
// rail off its top flange, which clears all four readiness issues
// (`specs/structure.md` § Readiness) and nothing else. The yard is emptied
// besides, so nothing collides, nothing breaks, and no rigging rule is involved in
// reaching the verdict this check is about.
//
// TWENTY FURTHER TICKS ARE DRIVEN AFTERWARDS, because "stays" is the requirement:
// a build that showed the run screen on the failing tick and then moved on a frame
// later would satisfy a reading taken at the verdict alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE } from "../constants";
import {
  createHarness,
  openSite,
  runTicks,
  runUntil,
  startRun,
  type Harness,
} from "../harness";

/**
 * The ring, and one rail off its top flange: the smallest ready structure.
 *
 * The rail is horizontal, it is one unbroken stretch of track, it lies in the arm
 * because it ends on a top-flange node, and its two ends stand at different
 * horizontal distances from the slew axis — the four track rules of
 * `specs/structure.md` § The trolley and the rail — so no readiness issue is
 * raised and the run starts.
 */
async function poseReadyCrane(harness: Harness): Promise<void> {
  await harness.debug.setRing(0, 2, 0);
  await harness.debug.addMember(0, 4, 0, 4, 4, 0, "rail");
}

/** A hoist target past `HOIST_MAX`, so the first tick ends the run. */
async function poseTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  await harness.debug.addMoveStep("hoist", HOIST_MAX + 60, HOIST_MAX_RATE);
}

/** Ticks the run is given to reach its verdict: it lands on the first. */
const END_CAP = 3;

/** Ticks driven after the verdict. */
const HELD_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the run screen after a run fails", async () => {
  await openSite(h, 0);
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await poseReadyCrane(h);
  await poseTape(h);
  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the steps the tape took, so the run runs the out-of-range command",
  );

  const ended = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    END_CAP,
    "the out-of-range command to end the run",
  );
  assertEqual(
    ended.run.phase,
    "failed",
    "the phase a command outside its axis's range leaves the run in " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.screen,
    "run",
    "the screen a failed run is on at the tick it failed (specs/ui.md)",
  );

  const held = await runTicks(h, HELD_TICKS);
  assertEqual(
    held.run.phase,
    "failed",
    `the phase the run holds ${HELD_TICKS} ticks later (specs/state.md)`,
  );
  assertEqual(
    held.screen,
    "run",
    `the screen showing ${HELD_TICKS} ticks after the failure: a failed run ` +
      "stays on the run screen (specs/ui.md)",
  );

  await h.capture("failed-run", "The run screen held after a failure");
});
