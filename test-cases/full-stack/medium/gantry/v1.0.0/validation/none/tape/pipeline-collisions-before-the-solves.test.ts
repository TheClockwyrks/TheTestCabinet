// tape/pipeline-collisions-before-the-solves — a tick tests its collisions before
// it runs its solves.
//
// `specs/program.md` § The tick pipeline orders the stages: "5. Collisions:
// members, the load, and the ground (`specs/statics.md`). 6. The solves
// (`specs/statics.md`) …". Collisions are stage 5 and the solves are stage 6, and
// "The first failure a tick reaches ends the run with that cause", so a tick that
// finds a member inside an obstacle reports `structure-struck-obstacle` even when
// the crane it belongs to would not have stood.
//
// THE CRANE IS THE SMALLEST STRUCTURE A RUN STARTS ON, AND IT COLLAPSES. The ring
// and one rail off its top flange clear every readiness issue
// (`specs/structure.md` § Readiness) and nothing else, so the run starts —
// "a ready structure may still be a mechanism" — and the arm the rail hangs off
// has nothing resisting a vertical displacement at its far end, so the arm solve
// is singular and `specs/statics.md` ends such a run as `collapse`: "A singular
// solve, in either the arm or the tower … ends the run as `collapse`."
//
// The check runs that crane once with an empty yard and reads `collapse` back,
// which is what makes the second run's verdict a statement about the ORDER of two
// stages rather than about one of them alone.
//
// THEN THE SAME CRANE AND THE SAME TAPE ARE GIVEN A STRIKE AS WELL. The structure
// and the tape are the ones the first run left standing — a failed run is no
// longer in progress, so the build screen takes the box and the second run starts
// on exactly the crane the first one collapsed — and a small box is placed over
// the middle of the rail, so the rail reaches inside it from the run's first tick.
// `specs/statics.md`: "A member whose segment reaches inside an obstacle ends the
// run as `structure-struck-obstacle`." Stage 5 now has a verdict and stage 6 would
// have had one, and only one of them may be reported.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneObstacle,
  createHarness,
  openSite,
  runTicks,
  startRun,
  type Harness,
} from "../harness";

/**
 * The smallest structure a run starts on: the ring, and one rail off its top
 * flange.
 *
 * `specs/structure.md` § Readiness names the four issues that refuse a run, and
 * this clears all four: the crane has a ring; it has a rail; that rail is a valid
 * track — horizontal, one unbroken stretch, in the arm, and with its two ends at
 * different horizontal distances from the slew axis; and the rail ends on a
 * top-flange node, so no member is disconnected. Nothing else is built, which is
 * what makes this the cheapest way to reach a tick of the real pipeline, and the
 * arm it forms is a mechanism, which is what gives stage 6 a verdict to be beaten
 * to.
 */
async function poseReadyCrane(h: Harness): Promise<void> {
  await h.debug.clearStructure();
  await h.debug.setRing(0, 2, 0);
  await h.debug.addMember(0, 4, 0, 4, 4, 0, "rail");
}

/** One step, done on the tick it is issued: the run's first tick is the reading. */
async function poseTape(h: Harness): Promise<void> {
  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await h.debug.addMoveStep("hoist", HOIST_START, HOIST_MAX_RATE);
}

/**
 * A box over the middle of the rail, which runs from `(0, 4, 0)` to `(4, 4, 0)`.
 *
 * It spans `x` `2.6` to `3.4` and `z` `-0.2` to `0.2`, so the rail passes through
 * its inside, and it stands clear of the ring's own eight nodes.
 */
const BOX_MIN = { x: 2.6, y: 3.6, z: -0.2 };
const BOX_SIZE = { x: 0.8, y: 0.8, z: 0.4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the obstacle strike on a tick whose crane would also collapse", async () => {
  // The crane alone: ready, and a mechanism.
  await openSite(h, 0);
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await poseReadyCrane(h);
  await poseTape(h);

  const check = await h.check();
  assertLength(
    check.issues,
    0,
    "the issues this crane carries: it is ready to run, so the run starts and " +
      "reaches the tick under test (specs/structure.md)",
  );

  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the steps the tape took, which is what the run under test runs",
  );
  const alone = await runTicks(h, 1);
  assertEqual(
    alone.run.cause,
    "collapse",
    "the cause this crane's first tick raises with nothing in its way: the " +
      "arm has nothing resisting a vertical displacement, so the solve is " +
      "singular (specs/statics.md)",
  );

  // The same crane and the same tape, with a box over the middle of the rail.
  // The run that just failed is no longer in progress, so the site poses apply
  // again (specs/instrumentation.md) and nothing is rebuilt.
  await h.debug.setScreen("build");
  await addOneObstacle(h, BOX_MIN, BOX_SIZE);

  await startRun(h);
  const struck = await runTicks(h, 1);

  await h.capture(
    "state",
    "The verdict of a tick that both struck and collapsed",
  );

  assertEqual(
    struck.run.phase,
    "failed",
    "the run after a tick whose rail lies inside an obstacle",
  );
  assertEqual(
    struck.run.cause,
    "structure-struck-obstacle",
    "the cause the tick raises: collisions are stage 5 and the solves are " +
      "stage 6, so the strike is the first failure the tick reaches and the " +
      "collapse the same crane reached without the box is never looked for " +
      "(specs/program.md)",
  );
});
