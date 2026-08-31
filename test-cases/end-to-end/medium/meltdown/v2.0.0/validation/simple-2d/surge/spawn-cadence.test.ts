// surge/spawn-cadence — units arrive one every 0.6 seconds of game time, the first
// on the frame the wave begins.
//
// THE RULE. specs/waves.md, The release: "A wave releases its units one at a time,
// one every `WAVE_SPAWN_INTERVAL` (`0.6`) seconds of game time, the first on the
// frame the wave begins. There is no variation in that cadence."
//
// TWO CLAIMS, READ SEPARATELY. Where the run of arrivals STARTS, and how far apart
// they are. A build that releases its whole wave a cadence interval late keeps the
// spacing and fails the first; a build that starts on the right frame and then
// releases every tenth of a second keeps the start and fails the second. They are
// asserted apart so a failure names which.
//
// THE CLOCK IS THE GAME'S OWN. `simTime` is what specs/waves.md accumulates game
// time in — "an interval of game time reaches the same state however it was divided
// into frames" — so every reading here is taken off the snapshot's `simTime` and
// none of them off a frame count. The wave is sampled ONE FRAME AT A TIME, so the
// moment each unit is first seen is the frame it was released on and not the end of
// a polling window.
//
// THE START IS READ ACROSS THE SEND ITSELF. `simTime` is read before the send key
// is pressed, and the first arrival's own reading is compared to it: pressing the
// key runs the one frame that delivers its edge, so a build that releases on the
// frame the wave begins has released before that reading is taken and the gap is
// one frame of this suite's clock.
//
// THE FIRST SIX ARRIVALS ARE ENOUGH, AND STOPPING THERE IS THE POINT. Five
// intervals is three seconds of game time, which is where a wrong cadence has
// already shown itself several times over; watching the remaining six units of the
// wave would read the same interval again and cost nothing but time. Every interval
// is asserted on its own, so a build that is regular for two units and then drifts
// fails on the interval it drifted at, and "There is no variation" is read as each
// gap standing alone rather than as an average.
//
// WAVE 1 IS THE WAVE, because the cadence has nothing to do with which type or how
// many: a wave of twelve Motes is simply the longest run of arrivals available
// without leaving the opening list.
//
// WHAT EVERY WRONG MODEL READS. A build that releases the whole wave at once reads
// six arrivals at one instant, so every gap is `0`; one that releases per FRAME
// rather than per interval of game time reads gaps of a hundred and twentieth of a
// second; one that waits a full interval before its first unit reads a start a
// whole `0.6` late; one that halves or doubles the interval reads `0.3` or `1.2`.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_SPAWN_INTERVAL } from "../../src/constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseWaveReady, watchRelease } from "./release";

/** The wave the cadence is read on: the run's first. */
const WAVE = 1;

/** How many arrivals are read: enough for five intervals back to back. */
const ARRIVALS = 6;

/**
 * How long those arrivals are waited for: eight seconds of game time.
 *
 * Geometry rather than a tolerance. Six units at the specified `0.6` seconds arrive
 * inside three seconds, so eight carries a build releasing at half the specified
 * rate all the way to its sixth unit — which is what makes a cadence twice too slow
 * fail on the INTERVAL it reads rather than on a watch that ran out.
 */
const WATCH_SECONDS = 8;

/**
 * How far an arrival may fall from where the cadence puts it: five hundredths of a
 * second of game time.
 *
 * A release resolves on a frame boundary, and this suite's frame is a hundred and
 * twentieth of a second, so a build that accumulates its spawn clock slightly
 * differently — or that resolves the send's edge on the frame after the one it was
 * reported in — is out by a frame or two. Five hundredths is six of this suite's
 * frames: an order of magnitude above that noise, and an order of magnitude below
 * the `0.6` it is measuring, so it separates the specified cadence from every
 * neighbouring one a build might have chosen — `0.3`, `0.5`, `1.0` — while
 * forgiving nothing that matters.
 */
const TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases the first unit as the wave begins and one every 0.6 s after", async () => {
  poseWaveReady(h, WAVE);

  // Read before the send: `watchRelease` is what presses the key.
  const sentAt = h.snapshot().simTime;
  const released = await watchRelease(h, {
    poll: 1,
    stopAfter: ARRIVALS,
    seconds: WATCH_SECONDS,
  });

  captureStill(h, "cadence");

  assertGreaterThanOrEqual(
    released.length,
    ARRIVALS,
    `precondition: the arrivals the wave produced inside ${WATCH_SECONDS} s of ` +
      `game time`,
  );

  // Where the run of arrivals starts.
  assertLessThanOrEqual(
    released[0].at - sentAt,
    TOLERANCE,
    "the game time between the wave being sent and its first unit arriving",
  );

  // And how far apart they are, each gap on its own.
  for (let index = 1; index < ARRIVALS; index += 1) {
    assertLessThanOrEqual(
      Math.abs(
        released[index].at - released[index - 1].at - WAVE_SPAWN_INTERVAL,
      ),
      TOLERANCE,
      `the game time between arrival ${index} and arrival ${index + 1}, ` +
        `against the ${WAVE_SPAWN_INTERVAL} s the cadence fixes`,
    );
  }
});
