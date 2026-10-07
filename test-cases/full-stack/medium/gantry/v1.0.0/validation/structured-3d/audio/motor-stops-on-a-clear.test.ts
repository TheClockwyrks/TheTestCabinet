// audio/motor-stops-on-a-clear — a run that clears the site stops the motor loop.
//
// specs/ui.md § Audio, the `motor` row: it "loops while a run is in progress and
// any axis's rate is nonzero, and is silent otherwise: a run that leaves the
// running phase stops it, whether it cleared, failed, or was aborted, whatever
// rates its axes were left holding".
//
// THE LAST CLAUSE IS THE POINT, and a clear is where it is easiest to get wrong:
// the run ends by moving to another screen entirely (specs/ui.md, "A cleared run
// moves to `results`"), so a build that leaves its loop to the run screen's own
// teardown, or that feeds it from "an axis's rate is nonzero" alone, plays the
// drive under `SITE CLEARED`.
//
// SO THE RUN IS LEFT HOLDING A RATE. The site is cleared by a real lift — the
// cable is drawn in to `HOIST_MIN`, the `attach` step takes the crate hanging at
// the hook point and the `release` step sets it down on its own pad, inside every
// tolerance by a wide margin — and the slew axis is given a rate through the
// surface before the last two ticks, which is exactly the state the clause names.
// The rate is read back on the clearing tick, so the check is about a run that
// ended holding one.
//
// THE DRAW-IN IS POSED TO ITS LAST FRACTION rather than driven the whole way.
// The hoist starts the run `NEAR` above the target the tape sends it to, with
// the bob hung under the pivot at that same length so the pendulum takes no
// jolt — which is the pairing specs/instrumentation.md names, "a caller that
// wants a bob the cable can hold sets the hoist axis to the distance it left
// between the pivot and the bob". Both are poses called before the run's first
// tick, when no step has been taken and no axis carries a command, so the tick
// that takes the move step issues exactly the command it would have issued
// anyway and the build's own controller draws the hoist in. Only the distance
// is short: the lift, the attach, the release and the clear are all still the
// run's own. Driving a whole unit of cable would put the hoist controller
// between this check and the motor loop it is about, and that controller is
// another point's requirement.
//
// The clearing tick is the tick AFTER the release: specs/program.md, "A tick that
// finds no live step and no step left to take is the tick the run ends on:
// cleared if every load is `placed`".
//
// The loop is read from BOTH of the probe's answers, before and after, because a
// build may loop by setting a source's `loop` flag or by re-scheduling the buffer
// end to end (validation/none/cues-init.js).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN, SLEW_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the bare hook comes to rest once the cable is drawn in to HOIST_MIN. */
const HOOK = { x: 0, y: HOIST_MIN + 2, z: 0, yaw: 0 } as const;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
];

/** Frames watched after the clear, for a loop that re-schedules rather than loops. */
const AFTER_FRAMES = 10;

/**
 * How much cable the run starts with over the target the first step names.
 *
 * Enough that the hoist is plainly under way — `HOIST_ACCEL` is `6`, so it is
 * still driving three ticks in, which is where the motor loop is read — and
 * little enough that the whole move is a dozen ticks rather than fifty.
 */
const NEAR = 0.05;

/** Ticks driven while the hoist is under way, before the loop is read. */
const DRAWING_TICKS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the motor loop on the tick a run clears, with an axis still holding a rate", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, HOOK, HOOK);
  await poseTape(h, TAPE);
  const opened = await startRun(h);

  const { pivot } = opened.run;
  await h.debug.setAxis("hoist", HOIST_MIN + NEAR);
  await h.debug.setBob(pivot.x, pivot.y - (HOIST_MIN + NEAR), pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);

  await h.cues();
  const drawing = await runTicks(h, DRAWING_TICKS);
  assertTrue(
    drawing.run.axes.hoist.rate !== 0,
    "the hoist drawing the cable in, so the motor loop is running",
  );
  const sounding = [...(await h.loopingCues()), ...(await h.cues())];
  assertTrue(
    sounding.includes("motor"),
    "the motor loop running while the run is in progress (specs/ui.md), so " +
      "there is a loop for the clear to stop",
  );

  const held = await runUntil(
    h,
    (s) => s.run.attached !== null || s.run.phase !== "running",
    60,
    "the attach step to take the load",
  );
  assertEqual(held.run.attached, 0, "the load the attach step took");

  // The rate the run will be left holding when it ends.
  await h.debug.setAxisRate("slew", SLEW_MAX_RATE);
  const released = await runTicks(h, 1);
  assertEqual(
    released.run.loads[0]?.phase,
    "placed",
    "the load the release set down (specs/rigging.md)",
  );
  assertEqual(
    released.run.phase,
    "running",
    "the run, one tick short of its end",
  );

  await h.debug.setAxisRate("slew", SLEW_MAX_RATE);
  await h.cues();
  const cleared = await runTicks(h, 1);
  assertEqual(cleared.run.phase, "cleared", "the run the last tick cleared");
  assertTrue(
    cleared.run.axes.slew.rate !== 0,
    "the slew rate the cleared run was left holding, which is the rate the " +
      "loop must stop in spite of (specs/ui.md)",
  );
  assertEqual(
    (await h.snapshot()).screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md)",
  );

  await h.cues();
  await h.advance(AFTER_FRAMES);
  const started = await h.cues();
  const looping = await h.loopingCues();

  await h.capture("cleared", "The results screen after the clear");

  assertTrue(
    !looping.includes("motor"),
    `no motor loop live over the ${AFTER_FRAMES} frames after the clear: a run ` +
      "that leaves the running phase stops it, whatever rates its axes were " +
      "left holding (specs/ui.md) — the loop is still running",
  );
  assertTrue(
    !started.includes("motor"),
    `no motor sound started over the ${AFTER_FRAMES} frames after the clear ` +
      "(specs/ui.md) — the loop is still being fed",
  );
});
