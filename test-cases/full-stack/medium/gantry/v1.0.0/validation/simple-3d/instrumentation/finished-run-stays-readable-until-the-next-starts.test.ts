// instrumentation/finished-run-stays-readable-until-the-next-starts — a run that
// ended is still there to read.
//
// specs/instrumentation.md § Snapshot shape gives `run` its resting value: "the
// idle placeholder `specs/state.md` gives it before a site's first run, and again
// whenever a site is opened, a run is aborted, or `reset` is called; otherwise the
// run last started, left as it ended until the next one starts." specs/state.md
// says what that buys: "A run that ends is left as it ended until the next one
// starts: its verdict, its cause, its clock, and its broken list stay readable...
// and going back to the build screen leaves them as they are."
//
// So the reading is the same four fields three times over: on the screen the run
// ended on, on the build screen the player goes back to, and on the program screen
// after that. Leaving the run screen is not one of the three things that puts the
// placeholder back, and a build that cleared the run on the way out reports an idle
// phase, a null cause and a zero clock at the second reading.
//
// THE RUN IS DRIVEN TO A FAILURE THAT BREAKS MEMBERS, so `broken` is a list with
// something in it rather than an empty one that would read the same however the
// build treated it. The crane is the minimal one; the trolley is run out to the far
// end of its track and a heavy crate hung there, which is the cantilever the arm's
// ties cannot hold: the load is under `HOIST_CABLE_CAP` (`3000`) so the hoist cable
// is not what gives, and `specs/statics.md` then has "every member whose
// utilization exceeds `1`" break. The tape is one long grip turn, an axis that
// moves nothing structural, so the run stays alive while the structure decides.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertDeepEqual,
} from "../assert";
import { GRIP_MAX_RATE, HOIST_CABLE_CAP, HOIST_MIN } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The far end of the minimal crane's track, and the pivot standing over it. */
const TIP = { x: 4, y: 4, z: 0 };

/** Under HOIST_CABLE_CAP at `GRAVITY`, so the cable is not what gives. */
const MASS = 250;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("still reports a failed run's phase, cause, clock and broken list off the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    MASS,
    { x: 6, y: 2, z: 0, yaw: 0 },
    { x: -6, y: 2, z: 0, yaw: 0 },
  );
  // A long turn of the grip: an axis whose value carries no structure, so the
  // tape neither ends nor loads the crane while the arm decides.
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
    },
  ]);
  await startRun(h);

  // The cantilever: the trolley at the track's far end, the cable short, and the
  // crate hanging on it at rest.
  await h.debug.setAxis("trolley", TIP.x);
  await h.debug.setAxis("hoist", HOIST_MIN);
  await h.debug.setBob(TIP.x, TIP.y - HOIST_MIN, TIP.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.debug.setLoadPhase(0, "attached");

  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    600,
    "the overloaded arm to give way",
  );

  assertEqual(ended.run.phase, "failed", "the verdict the overloaded arm reaches");
  assertNotNull(ended.run.cause, "the cause a failed run carries");
  assertGreaterThan(ended.run.tick, 0, "the clock the run stopped at");
  assertGreaterThan(
    ended.run.broken.length,
    0,
    `the members broken under a ${MASS}-mass load, which is inside ` +
      `HOIST_CABLE_CAP (${HOIST_CABLE_CAP}) so the cable is not what gave ` +
      "(specs/statics.md)",
  );

  const verdict = {
    phase: ended.run.phase,
    cause: ended.run.cause,
    tick: ended.run.tick,
    broken: ended.run.broken,
  };

  for (const screen of ["build", "program"] as const) {
    await h.debug.setScreen(screen);
    const s = await h.snapshot();
    assertDeepEqual(
      {
        phase: s.run.phase,
        cause: s.run.cause,
        tick: s.run.tick,
        broken: s.run.broken,
      },
      verdict,
      `the finished run, read on the ${screen} screen: it is "left as it ` +
        'ended until the next one starts" (specs/state.md)',
    );
  }

  await h.advance(1);
  await h.capture(
    "finished-run-readable",
    "The finished run, still readable from the program screen",
  );
});
