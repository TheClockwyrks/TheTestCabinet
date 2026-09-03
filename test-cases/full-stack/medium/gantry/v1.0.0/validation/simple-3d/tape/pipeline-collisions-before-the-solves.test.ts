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
// THE CRANE IS ONE THAT COLLAPSES, AND THE CHECK PROVES IT TWICE OVER. It is the
// minimal crane with the tie between the mast and the rail's far end taken away,
// which leaves every member at that tip lying in the `y = 4` plane: nothing there
// resists a vertical displacement, so the arm's supported system is singular and
// `specs/statics.md` ends such a run as `collapse` — "A singular solve, in either
// the arm or the tower … ends the run as `collapse`. An under-braced 3D truss is
// the ordinary way to get here: a flat frame with nothing resisting out-of-plane
// motion is a mechanism even though every member is sound." The structure is
// nonetheless READY — it has its ring, its rails form one straight track, and
// every member is connected — so the run starts, and `specs/structure.md` agrees
// that "a ready structure may still be a mechanism".
//
// The check runs that crane once with an empty yard and reads `collapse` back,
// which is what makes the second run's verdict a statement about the ORDER of two
// stages rather than about one of them alone.
//
// THEN THE SAME TICK IS GIVEN A STRIKE AS WELL. A small box is placed over the
// middle of the rail after the crane is built, so the rail reaches inside it from
// the run's first tick — `specs/statics.md`: "A member whose segment reaches
// inside an obstacle ends the run as `structure-struck-obstacle`." The box is
// narrow enough in `z` that the two diagonal ties to the tip pass outside it, so
// the strike is the rail's. Stage 5 now has a verdict and stage 6 would have had
// one, and only one of them may be reported.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  MINIMAL_CRANE,
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/**
 * The minimal crane less the tie from the mast to the rail's far end.
 *
 * That member is the only one at `(4, 4, 0)` with a vertical component; without
 * it the tip is free to fall and the arm solve is singular.
 */
const UNBRACED_TIP: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Unbraced tip",
  members: MINIMAL_CRANE.members.slice(0, -1),
};

/** One step, done on the tick it is issued: the run's first tick is the reading. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
  },
];

/**
 * A box over the middle of the rail, which runs from `(0, 4, 0)` to `(4, 4, 0)`.
 *
 * It spans `x` `2.6` to `3.4` and `z` `-0.2` to `0.2`, so the rail passes through
 * its inside while the ties from `(0, 4, 2)` and `(2, 4, 2)` to the tip, which
 * have crossed to `z = 0.4` and `z = 0.6` by then, pass outside it.
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
  await clearAll(h);
  await poseCrane(h, UNBRACED_TIP);
  await poseTape(h, TAPE);

  const check = await h.check();
  assertLength(
    check.issues,
    0,
    "the issues this crane carries: it is ready to run, so the run starts and " +
      "reaches the tick under test (specs/structure.md)",
  );

  await startRun(h);
  const alone = await runTicks(h, 1);
  assertEqual(
    alone.run.cause,
    "collapse",
    "the cause this crane's first tick raises with nothing in its way: the " +
      "arm's tip has nothing resisting a vertical displacement, so the solve " +
      "is singular (specs/statics.md)",
  );

  // The same crane and the same tape, with a box over the middle of the rail.
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, UNBRACED_TIP);
  await poseTape(h, TAPE);
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
