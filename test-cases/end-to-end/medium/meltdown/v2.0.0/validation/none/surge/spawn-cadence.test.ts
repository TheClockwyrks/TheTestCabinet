// Meltdown — surge/spawn-cadence: a wave releases one unit every 0.6 seconds of
// game time, starting on the frame it begins.
//
// THE RULE. `specs/waves.md`: "A wave releases its units one at a time, one every
// `WAVE_SPAWN_INTERVAL` (`0.6`) seconds of game time, the first on the frame the
// wave begins. There is no variation in that cadence."
//
// TWO CLAIMS, AND THEY FAIL DIFFERENTLY.
//
//   WHEN THE FIRST ONE COMES. On the frame the wave begins — not one interval
//   later. A build that starts its spawn clock at zero and releases when the
//   clock REACHES the interval leaves the floor empty for the first `0.6`
//   seconds, which is a real difference to the player: an early send buys nothing
//   for more than half a second. The send here is delivered inside a single frame
//   (`Harness.tap`), and the reading is how many frames pass before the first unit
//   is on the floor.
//
//   HOW FAR APART THE REST ARE. The interval between consecutive releases, read
//   off `simTime`, which "accumulates the game time the simulation advanced by"
//   (`specs/instrumentation.md`) and is therefore the very clock the specification
//   states the cadence in. Four consecutive gaps are read rather than one, because
//   "no variation in that cadence" is a claim about all of them: a build that
//   released the first two together and then settled, or that let its accumulator
//   drift by a frame each time, is named by the gap it got wrong.
//
// EVERY FRAME IS SAMPLED, which is what makes the reading a reading of the
// cadence rather than of the sampling: the quantity in question is `0.6` seconds
// and the interval between two samples is one frame of the suite's clock,
// `1 / 120` of a second, seventy-two times finer.
//
// WAVE 1 IS READ because it is a twelve-Mote wave (`specs/waves.md`), so five
// releases fit inside it with seven to spare and nothing here runs into the end
// of a wave. Which type it releases is `surge/wave-type-opening`'s and how many
// is `surge/wave-size`'s; what is read here is only when each one arrived.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  TICK_HZ,
  captureStill,
  createHarness,
  framesFor,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";
import { openWave } from "./roster";

/** The wave the cadence is read on, and how many of its releases are timed. */
const WAVE = 1;
const RELEASES = 5;

/**
 * How many frames may pass between the send and the first unit standing on the
 * floor.
 *
 * `Harness.tap` presses the key, runs exactly one frame with it down, and
 * releases it, and `specs/controls.md` leaves a build free to answer that press
 * before or after the frame's own update — so a conformant build releases its
 * first unit on either that frame or the one after it. Two frames is that
 * latitude and nothing more: the model this excludes, a first release one whole
 * `WAVE_SPAWN_INTERVAL` in, is seventy-two frames away.
 */
const FIRST_RELEASE_FRAMES = 2;

/**
 * How far a gap between two releases may sit from `WAVE_SPAWN_INTERVAL`, in
 * seconds of game time.
 *
 * Each release is read at the first frame boundary at or after it, so a gap
 * carries at most one frame of quantisation; three frames of the suite's `120` Hz
 * clock is `0.025` s, which is that quantisation with two frames of margin for a
 * build whose accumulator lands a whisker either side of the interval after a
 * hundred floating-point additions. It is a twenty-fourth of the figure it
 * measures, and every cadence a build might have chosen instead — `0.5`, `0.75`,
 * `1.0`, half an interval — is at least four times this bound away.
 */
const GAP_TOLERANCE = 3 / TICK_HZ;

/** How long the timing sweep may run: five intervals with a second to spare. */
const SWEEP_FRAMES = framesFor(WAVE_SPAWN_INTERVAL * RELEASES + 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("releases the first unit on the frame the wave begins and one every 0.6 s after", async () => {
  await openWave(h, WAVE);

  // WHEN THE FIRST ONE CAME, in frames after the send's own frame.
  const opening = await h.until((snapshot) => snapshot.surge.length >= 1, {
    maxFrames: framesFor(WAVE_SPAWN_INTERVAL * 2),
    poll: 1,
  });

  // WHEN EACH OF THE NEXT ONES CAME, by the game's own accumulated clock. The
  // gathering happens inside the sweep because a sample is one crossing.
  const seen = new Set<number>();
  const at: number[] = [];
  const record = (snapshot: MeltdownSnapshot): void => {
    for (const unit of snapshot.surge) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      at.push(snapshot.simTime);
    }
  };
  record(opening.snapshot);
  await h.until(
    (snapshot) => {
      record(snapshot);
      return at.length >= RELEASES;
    },
    { maxFrames: SWEEP_FRAMES, poll: 1 },
  );

  await captureStill(h, "cadence");

  assertLessThanOrEqual(
    opening.frames,
    FIRST_RELEASE_FRAMES,
    "frames of game time between the send and the wave's first unit standing " +
      "on the floor: specs/waves.md releases it on the frame the wave begins",
  );
  assertEqual(
    at.length,
    RELEASES,
    `releases timed inside ${WAVE_SPAWN_INTERVAL * RELEASES + 1} s of game ` +
      `time: a wave of ${RELEASES} or more releases one every ` +
      `${WAVE_SPAWN_INTERVAL} s (specs/waves.md)`,
  );
  for (let index = 1; index < at.length; index += 1) {
    assertLessThanOrEqual(
      Math.abs(at[index] - at[index - 1] - WAVE_SPAWN_INTERVAL),
      GAP_TOLERANCE,
      `release ${index} came ${WAVE_SPAWN_INTERVAL} s of game time after ` +
        `release ${index - 1} (specs/waves.md); it came ` +
        `${(at[index] - at[index - 1]).toFixed(4)} s after it, off by`,
    );
  }
});
