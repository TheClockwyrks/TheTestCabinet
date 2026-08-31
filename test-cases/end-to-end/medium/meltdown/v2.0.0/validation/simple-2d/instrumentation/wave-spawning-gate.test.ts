// Meltdown — instrumentation/wave-spawning-gate: wave spawning off keeps the run's
// surge away.
//
// specs/instrumentation.md, The world gate: `setWaveSpawning(enabled)` gates "The
// run's own release of surge: the build timer's automatic start of the next wave
// when it reaches `0`, and the spawner's release of the units counted by
// `wavePending`. Off, no unit arrives unless one is added ... The timer still counts
// down, a unit already on the floor still walks, and everything else runs on."
//
// THIS IS THE GATE ALMOST EVERY OTHER CHECK IN THIS SUITE STANDS ON. `startRun` shuts
// it, which is what lets a scenario pose exactly the entities its requirement
// concerns and know that nothing else will arrive across whatever it is measuring. A
// build whose gate does not hold has a wave walking through every window in this
// project.
//
// A WHOLE MINUTE OF GAME TIME, AND THIRTY PENDING. specs/waves.md releases one unit
// every `WAVE_SPAWN_INTERVAL` (`0.6`) seconds, so a minute is a hundred intervals —
// three times over what thirty pending units need. A build whose gate leaks even one
// unit, or leaks at a hundredth of the specified cadence, has a full minute in which
// to do it, and `wavePending` must be untouched at the end of it: a build that
// counted a release down without producing a unit is caught on the count rather than
// on the roster.
//
// AND THE SAME WAVE IS RELEASED WITH THE GATE OPEN, because "no unit arrives" is a
// claim about the GATE and not about a spawner that does not work. A build that never
// releases anything passes the held leg outright, so the second leg requires the
// roster to fill and the pending count to fall. That leg is read over five seconds
// rather than a minute, which is long enough for the release to be unmistakable and
// short enough that nothing has crossed the floor and leaked — specs/surge.md gives
// a Mote `60` logical units a second, and the shortest crossing is far longer than
// that.
//
// THE GATE IS TURNED ON HERE, and this is one of the two items in this group whose
// requirement it is (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLength,
} from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../../src/constants";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";

/** How many units the wave has left to release. */
const PENDING = 30;

/** How long the held leg is driven for: a minute of game time. */
const QUIET_TICKS = ticksFor(60);

/**
 * How long the open leg is driven for: five seconds of game time.
 *
 * Geometry rather than a tolerance. specs/waves.md releases the first unit on the
 * frame the wave begins and one every `WAVE_SPAWN_INTERVAL` after it, so five
 * seconds is eight intervals — and it is far short of the time a Mote needs to cross
 * the floor at its specified speed, so nothing released has left again by the time
 * the roster is read.
 */
const RELEASED_TICKS = ticksFor(5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open a wave phase with `PENDING` units left to release and the gate as named. */
function poseWave(gate: boolean): void {
  startRun(h);
  h.debug.setWaveSpawning(gate);
  h.debug.setPhase("wave");
  h.debug.setWavePending(PENDING);
}

it("releases no unit over a minute with the gate off", async () => {
  poseWave(false);
  await h.advance(QUIET_TICKS);
  const quiet = h.snapshot();
  captureStill(h, "quiet");

  assertLength(
    quiet.surge,
    0,
    `units the run released over ${QUIET_TICKS / ticksFor(1)} seconds with the gate off`,
  );
  assertEqual(
    quiet.wavePending,
    PENDING,
    "units still to release, with the gate off",
  );
});

it("fills the roster over the same wave with the gate on", async () => {
  poseWave(true);
  await h.advance(RELEASED_TICKS);
  const released = h.snapshot();
  captureStill(h, "released");

  assertGreaterThan(
    released.surge.length,
    0,
    `units the run released over ${RELEASED_TICKS / ticksFor(1)} seconds with the gate on`,
  );
  assertLessThan(
    released.wavePending,
    PENDING,
    `units still to release, with the gate on and ${WAVE_SPAWN_INTERVAL}s between releases`,
  );
});
