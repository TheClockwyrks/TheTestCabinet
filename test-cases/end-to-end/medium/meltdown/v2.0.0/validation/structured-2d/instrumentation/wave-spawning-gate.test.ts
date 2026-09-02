// Meltdown — instrumentation/wave-spawning-gate: wave spawning off keeps the
// run's surge away.
//
// `specs/instrumentation.md`, the world gate: `setWaveSpawning(enabled)` gates
// "The run's own release of surge: the build timer's automatic start of the next
// wave when it reaches `0`, and the spawner's release of the units counted by
// `wavePending`. Off, no unit arrives unless one is added ... The timer still
// counts down, a unit already on the floor still walks, and everything else runs
// on."
//
// THIS IS THE GATE EVERY OTHER SCENARIO IN THIS SUITE RESTS ON. `harness.ts`
// opens a run with it off so that a check spending fifteen seconds of game time
// on a cooling curve or a trip cooldown is not invaded by a wave, and a build
// whose gate does nothing would leave a floor full of surge in the middle of a
// hundred other readings. So this point reads the release half of it, and reads
// it over a long enough window that no cadence could hide inside.
//
// A MINUTE, BECAUSE THE CADENCE IS `0.6` SECONDS. `specs/waves.md` releases one
// unit every `WAVE_SPAWN_INTERVAL` and thirty are owed, so a build with a working
// spawner and a broken gate empties `wavePending` inside eighteen seconds. A
// minute is more than three times that: the quiet leg is not quiet because the
// window was short.
//
// AND `wavePending` IS READ BESIDE THE ROSTER. A build that released its units
// and then removed them again would keep the roster empty and empty the counter;
// a build that decremented the counter without releasing anything would do the
// reverse. Off, both must stand exactly where they were posed.
//
// THE OPEN LEG IS THE OTHER HALF, and it is read on an identical floor with the
// gate turned back on: a build that never spawns at all passes the quiet leg
// outright, and this is what names it. It is read as "the roster fills" rather
// than as a count at a moment, because how many units a wave has released by a
// given second is `surge/spawn-cadence`'s figure and not this gate's.
//
// THE PHASE IS `wave` AND IS POSED RATHER THAN REACHED, because `setPhase` "sets
// that field alone and runs no entry effect": what is under test is the
// spawner's release of the units already owed, and reaching the phase through a
// send would pay a bonus and re-count the wave on the way in.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  startRun,
  type Harness,
} from "../harness";

/** What the wave is posed as still owing. */
const PENDING = 30;

/** The game time the quiet leg is watched over, in seconds. */
const QUIET_WINDOW = 60;

/**
 * The game time the open leg is given, in seconds.
 *
 * `specs/waves.md` releases the first unit on the frame the wave begins and one
 * every `WAVE_SPAWN_INTERVAL` after it, so three intervals is room for a build
 * whose cadence is slower than the specification's to release something. What is
 * read is that the roster fills at all; the cadence itself belongs to `surge/`.
 */
const OPEN_WINDOW = WAVE_SPAWN_INTERVAL * 3;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

/** A run posed in its wave phase owing `PENDING` units, with the gate as given. */
function poseWave(spawning: boolean): void {
  startRun(h);
  h.debug.setPhase("wave");
  h.debug.setWavePending(PENDING);
  h.debug.setWaveSpawning(spawning);
}

it("releases nothing over a minute with the gate off, and fills the roster with it on", async () => {
  assertGreaterThan(
    QUIET_WINDOW,
    PENDING * WAVE_SPAWN_INTERVAL,
    "precondition: the quiet window outlasts the whole wave's own cadence",
  );

  // ---- The gate closed ---------------------------------------------------
  poseWave(false);
  assertLength(h.snapshot().surge, 0, "precondition: the floor opened empty");
  await h.advance(driveFrames(QUIET_WINDOW));
  captureStill(h, "quiet");
  const quiet = h.snapshot();

  assertLength(
    quiet.surge,
    0,
    `the units released over ${QUIET_WINDOW} seconds with the gate off`,
  );
  assertEqual(
    quiet.wavePending,
    PENDING,
    `the units still owed after ${QUIET_WINDOW} seconds with the gate off`,
  );

  // ---- The gate open, on an identical floor ------------------------------
  poseWave(true);
  assertLength(h.snapshot().surge, 0, "precondition: the floor opened empty");
  await h.advance(driveFrames(OPEN_WINDOW));
  captureStill(h, "released");
  const released = h.snapshot();

  assertGreaterThanOrEqual(
    released.surge.length,
    1,
    `the units released over ${OPEN_WINDOW} seconds with the gate on`,
  );
  assertGreaterThan(
    PENDING - released.wavePending,
    0,
    "the units the release took off the wave's own count, with the gate on",
  );
});
