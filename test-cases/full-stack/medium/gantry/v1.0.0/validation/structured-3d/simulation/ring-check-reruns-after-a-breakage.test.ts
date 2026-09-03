// simulation/ring-check-reruns-after-a-breakage — a breakage pass that overloads
// a corner ends the run as ring-overload.
//
// specs/statics.md § Utilization and breakage: after members break, "Both solves
// then run again at the same tick, over the members still intact, with the lumped
// masses and the applied forces recomputed for them, IN THE SAME ORDER AND UNDER
// THE SAME CHECKS." One of those checks is the ring's: § The two solves says each
// corner's reaction magnitude "is checked against `RING_CAP` at each of the four
// corners: it stays at or below it, and a tick on which one exceeds it ends the
// run as `ring-overload`". So a pass whose remaining members drive a corner past
// `RING_CAP` (`6000`) ends the run on that same tick — the check is not something
// the first pass alone gets.
//
// THE SCENARIO IS THE REFERENCE CRANE FOR HIGH SHELF, CARRYING A LOAD ITS TAPE
// NEVER LIFTS. The trolley is posed out to `10` along its track and a `180`-mass
// load is hung on the hook, which reaches the structure as the cable force
// specs/rigging.md fixes: at rest `(HOOK_MASS + 180) * GRAVITY` straight down at
// the trolley point, under `HOIST_CABLE_CAP` so the cable does not snap first.
// The first pass's corner reactions stay under `RING_CAP` and the pass breaks
// eleven members; the pass that follows, over what is left, drives a corner past
// it. So `run.broken` carries the members that broke on this tick AND the run
// ends as `ring-overload`, which is the pair a build that ran the ring check once
// per tick rather than once per pass cannot produce.
//
// The load is hung with `setLoadPhase`, which specs/instrumentation.md defines as
// hanging a load on the hook "exactly as a successful `attach` leaves it, without
// the candidate search", so nothing here runs the `attach` action or the rules
// that belong to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  DESIGNS,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** High Shelf, and the reference crane authored for it. */
const SITE = 4;

/** Far enough out along the crane's track to swing the corner reactions. */
const TROLLEY = 10;

/** Heavy enough to break members, light enough not to snap the hoist cable. */
const LOAD_MASS = 180;

/** Where the load waits: on the hook, which is where it is hung from. */
const ON_THE_HOOK = { x: 0, y: 2, z: 0, yaw: 0 };

/** A tape that keeps the run ticking and touches nothing the solve reads. */
const TURN_THE_GRIP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as ring-overload on the pass that follows a breakage", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, DESIGNS[SITE]);
  await addOneLoad(h, "crate", LOAD_MASS, ON_THE_HOOK, ON_THE_HOOK);
  await poseTape(h, TURN_THE_GRIP);

  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("trolley", TROLLEY);
  const { run } = await runTicks(h, 1);
  await h.capture(
    "run-phase-run-cause-run-broken-run-tick",
    "run.phase, run.cause, run.broken, run.tick",
  );

  assertEqual(run.tick, 1, "the tick this verdict was reached on");
  assertGreaterThan(
    run.broken.length,
    0,
    "the members this tick's first pass broke, which is what makes the ring " +
      "check that follows a rerun (specs/statics.md § Utilization and " +
      "breakage)",
  );
  assertEqual(
    run.phase,
    "failed",
    "the run's phase on the tick a pass over the remaining members drives a " +
      "corner past RING_CAP",
  );
  assertEqual(
    run.cause,
    "ring-overload",
    "the cause a ring connection exceeding RING_CAP ends the run with " +
      "(specs/statics.md § The failure causes)",
  );
});
