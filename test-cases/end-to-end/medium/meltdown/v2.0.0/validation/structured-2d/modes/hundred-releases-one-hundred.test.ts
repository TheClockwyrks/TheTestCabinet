// Meltdown — modes/hundred-releases-one-hundred: the onslaught is one wave of
// exactly a hundred units, and no more arrive after them.
//
// THE RULE. `specs/modes.md`, The Hundred: "It runs a single wave of exactly
// `HUNDRED_UNITS` (`100`) units, released at the same `WAVE_SPAWN_INTERVAL`
// cadence every wave uses." `specs/waves.md` fixes how a wave starts from the
// untimed opening phase: "Sending is what begins Wave 1."
//
// THE WAVE IS SENT, NOT POSED. `wavePending` has a setter, so a posed `100` would
// be asserting the number this point is supposed to be reading. The run is opened
// on The Hundred in its opening phase instead and the wave is begun with the real
// `send` action, so the count is the build's own answer to "how many does this
// mode owe?" — and the world gate is turned back on, because the spawner's
// release IS this item's requirement (it is one of the closed list of items that
// turn it on).
//
// THIS POINT GRADES THE COUNT AND MUST NOT GRADE THE CADENCE. `surge.spawn-cadence`
// is what decides the one-every-`0.6`-seconds rate, so the drive here runs until
// the spawner says it owes nothing more rather than for a fixed span — a fixed
// span the length of a compliant release would fail every build that releases a
// hundred units a little slower than specified, which is the other item's fault
// to find. The ceiling on that drive is THREE TIMES the game time a compliant
// release takes, so a build has to be more than three times too slow before this
// point runs out of patience, and even then it fails on the units it managed to
// release rather than on the clock.
//
// THE CLOCK IS THIS CHECK'S OWN, at `30` Hz rather than the suite's `120`. The
// drive covers minutes of game time, and `specs/waves.md` fixes that "an interval
// of game time reaches the same state however it was divided into frames", so a
// coarser division reaches the same release at a quarter of the frames. The step
// is `1/30` of a second, eighteen frames inside one `WAVE_SPAWN_INTERVAL`, so the
// cadence is still resolved many times over and no release can be lost between
// two frames.
//
// EVERY RELEASED UNIT IS FROZEN WHERE IT ARRIVES. `setUnitMotion(id, false)` holds
// a unit's locomotion "and nothing else" (`specs/instrumentation.md`), so the
// roster is a tally of what the spawner released rather than of what happened to
// it afterwards. That matters in three ways: nothing walks out through an
// exhaust, so no leak enters the count or spends a life; nothing dies, so the
// wave never clears out from under the reading; and the run never ends, so the
// spawner is watched to the end of what it owes. What each unit does after it
// arrives is `mazing`'s and `waves`'s business, not this item's.
//
// THE SECOND LEG IS THE "AND NO MORE" HALF, and it is long enough to catch the
// wrong model it is aimed at. A build that treats the onslaught as the first of
// several waves clears nothing here — the hundred are still standing — but a
// build that starts a further wave on a timer would start it within
// `BUILD_PHASE_TIME` (`15` seconds), so the quiet leg runs that long plus three
// more cadence intervals, and the roster must not gain a single unit over it.
//
// WHAT EVERY WRONG MODEL READS. A build that runs the standard progression
// releases wave 1's twelve Motes and then stops; one that reads the count off
// another mode's row releases one or twenty; one that releases twice the
// onslaught reads `200`; one that keeps releasing forever reads more in the quiet
// leg than it did at the end of the first. The figure is a whole number of units
// and carries no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { ConstantClock } from "@test-cabinet/structured-2d";
import {
  BUILD_PHASE_TIME,
  HUNDRED_UNITS,
  WAVE_SPAWN_INTERVAL,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The mode this point reads. */
const MODE = "hundred";

/**
 * This check's own clock, in frames per second.
 *
 * Coarser than the suite's `120` because the drive covers minutes of game time.
 * `1/30` of a second is eighteen frames inside one `WAVE_SPAWN_INTERVAL`, so the
 * release cadence is resolved many times over.
 */
const CLOCK_HZ = 30;

/** Whole frames of this check's clock covering `duration` seconds of game time. */
function frames(duration: number): number {
  return Math.round(duration * CLOCK_HZ);
}

/** The game time a release at the specified cadence takes, in seconds. */
const SPEC_RELEASE = HUNDRED_UNITS * WAVE_SPAWN_INTERVAL;

/**
 * How long the spawner is given to finish what it owes: three times that.
 *
 * Geometry, not a tolerance. The drive stops as soon as the spawner owes
 * nothing, so a compliant build spends a minute of game time here; the ceiling
 * exists only so a build that never finishes still reaches a verdict, and it is
 * set far enough out that no plausible cadence error decides this item.
 */
const CEILING = frames(3 * SPEC_RELEASE);

/**
 * How long the floor is watched afterwards for a hundred-and-first unit: a whole
 * build phase plus three cadence intervals, which is long enough for a build that
 * opens a further wave on a timer to open it.
 */
const QUIET = frames(BUILD_PHASE_TIME + 3 * WAVE_SPAWN_INTERVAL);

/**
 * How often the roster is swept to freeze what has arrived: every quarter second
 * of game time, comfortably inside one cadence interval, so every unit is frozen
 * long before it could cross the floor.
 */
const POLL = frames(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / CLOCK_HZ) });
});

afterEach(() => {
  h?.dispose();
});

/** Hold every unit on the floor exactly where the spawner put it. */
function freezeArrivals(): void {
  for (const unit of h.snapshot().surge) {
    if (unit.motion) h.debug.setUnitMotion(unit.id, false);
  }
}

/** Advance `limit` frames, freezing each arrival, stopping early on `done`. */
async function watch(limit: number, done?: () => boolean): Promise<boolean> {
  for (let run = 0; run < limit; run += POLL) {
    await h.advance(Math.min(POLL, limit - run));
    freezeArrivals();
    if (done?.() === true) return true;
  }
  return done === undefined;
}

it("releases exactly a hundred units in one wave and none after them", async () => {
  startRun(h, MODE);
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(0);
  h.debug.setWavePending(0);
  h.debug.setWaveSpawning(true);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.mode, MODE, "precondition: the mode the run is posed on");
  assertEqual(
    before.phase,
    "opening",
    "precondition: the phase the wave is sent from",
  );
  assertEqual(
    before.surge.length,
    0,
    "precondition: the floor before the send",
  );

  await tapAction(h, "send");
  const finished = await watch(CEILING, () => h.snapshot().wavePending <= 0);
  const released = h.snapshot().surge.length;

  await watch(QUIET);
  const after = h.snapshot();
  captureStill(h, "onslaught");

  assertTrue(
    finished,
    `precondition: the spawner finished what it owed inside ` +
      `${String(3 * SPEC_RELEASE)} seconds of game time; it had ` +
      `${String(after.wavePending)} still owed`,
  );
  assertEqual(
    released,
    HUNDRED_UNITS,
    "the units the onslaught released in one wave",
  );
  assertEqual(
    after.surge.length,
    HUNDRED_UNITS,
    `the units on the floor a further ` +
      `${String(BUILD_PHASE_TIME + 3 * WAVE_SPAWN_INTERVAL)} seconds after ` +
      `the onslaught was released`,
  );
});
