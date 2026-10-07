// Floe — instrumentation/state-gates: the four world gates are reported and each
// reads back, in both directions.
//
// `specs/instrumentation.md` states the rule the whole surface is built to:
// "`snapshot` returns exactly this object. Every field an operation can set is
// present, so every operation is verifiable by setting it and reading it back."
// The rest of this suite reads its verdicts out of that object, so a field that
// is absent, that answers with something of the wrong kind, or that fails to
// report what a pose put into it costs the point that asks for it somewhere
// else, under a heading about a mechanic. This family of the shape is named
// here instead.
//
// THE SHAPE AND THE READ-BACK ARE ONE CLAIM PER FAMILY, and the families are
// separate points. A build whose bears report nothing usable must grade
// differently from one whose whole snapshot is wrong, and a single point over
// the whole surface can only fail once — so the six `instrumentation/state-*`
// points divide the object along the lines `specs/instrumentation.md` itself
// draws.
//
// EVERY POSE IS READ BEFORE ANYTHING RUNS. The harness holds the game off its own
// clock, so nothing happens between a pose and the snapshot that checks it: one
// tick would run the hold, the cooldown and the lanes on, and the check would be
// reading the update rather than the pose.
//
// EVERY VALUE IS ONE THE POSE HAD TO CARRY. Each is deliberately not the value
// `startCrossing` left behind, so a build that ignores a pose reads back the
// value it already held rather than the one asked for, and the failure names the
// operation. Each boolean is posed BOTH WAYS for the same reason: a field read
// back once could be a constant.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That a
// posed gate holds a faculty off is each gate item's, that a posed step is
// carried out is `hunter/*`'s, and that a lane at a speed carries its items that
// far is `ice/*`'s and `water/*`'s.
//
// THE FOUR ARE ONE FAMILY AND ONE POINT. `specs/instrumentation.md` gives the run
// four faculties of its own — the emergence of bears, the catch test, the bonus
// catch's cadence and the crossing timer — each with a gate that is on at a fresh
// start, restored to on by `reset`, and reported by `snapshot`. What each gate
// DOES is four points of its own (`instrumentation/bear-emergence-gate` and its
// three neighbours); this one is that all four are reported and that each one
// stores what it was handed.
//
// EACH IS POSED BOTH WAYS, because a gate read back once could be a constant and
// a snapshot that always answers `false` would pass a single reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The strait the per-entity poses below are applied to. */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the four world gates and reads every pose of them back", async () => {
  await startCrossing(h);

  await h.advance(1);
  // Taken before the walk, so a pose that fails to land still leaves the picture
  // of the strait it was applied to.
  await captureStill(h, "read-back");

  const s = await h.snapshot();

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = async <T>(
    pose: () => Promise<void>,
    read: (s: FloeSnapshot) => T,
    want: T,
    what: string,
  ): Promise<void> => {
    await pose();
    assertEqual(read(await h.snapshot()), want, what);
  };

  // ---- The four gates the run reports -----------------------------------

  assertEqual(typeof s.bearEmergence, "boolean", "snapshot().bearEmergence");
  assertEqual(typeof s.catchTest, "boolean", "snapshot().catchTest");
  assertEqual(typeof s.fishCadence, "boolean", "snapshot().fishCadence");
  assertEqual(typeof s.timerRunning, "boolean", "snapshot().timerRunning");

  // ---- What each pose reads back, in both directions --------------------

  for (const enabled of [true, false]) {
    await readsBack(
      () => h.debug.setBearEmergence(enabled),
      (s) => s.bearEmergence,
      enabled,
      `snapshot().bearEmergence after setBearEmergence(${enabled})`,
    );
    await readsBack(
      () => h.debug.setCatchTest(enabled),
      (s) => s.catchTest,
      enabled,
      `snapshot().catchTest after setCatchTest(${enabled})`,
    );
    await readsBack(
      () => h.debug.setFishCadence(enabled),
      (s) => s.fishCadence,
      enabled,
      `snapshot().fishCadence after setFishCadence(${enabled})`,
    );
    await readsBack(
      () => h.debug.setTimerRunning(enabled),
      (s) => s.timerRunning,
      enabled,
      `snapshot().timerRunning after setTimerRunning(${enabled})`,
    );
  }
});
