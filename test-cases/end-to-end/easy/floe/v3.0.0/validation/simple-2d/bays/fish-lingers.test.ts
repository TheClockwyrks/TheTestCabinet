// bays/fish-lingers — a bonus catch stays in its bay for `FISH_LINGER`, then
// leaves.
//
// specs/bays.md: "A bonus catch lingers in its bay this long, then leaves —
// `FISH_LINGER` (`5` s)", and "A bonus catch leaves when it has lingered
// `FISH_LINGER`, or the moment its bay is filled, whichever comes first."
//
// The catch is POSED rather than waited for, because `setFishBay` is specified to
// start the clock this point measures: "Puts the bonus catch in bay `index`; its
// linger clock starts at the call" (specs/instrumentation.md). Posing is what
// isolates the linger from the interval before it — a build with a wrong
// `FISH_INTERVAL` should fail `bays/fish-interval` and pass here — and it fixes
// the instant the measurement starts from to the call rather than to a poll.
//
// The cadence gate goes back on, since the leaving this point measures is the
// cadence's own doing. Nothing else is on the strait, and no bay is filled, so
// the only thing that can take the catch off is the linger running out.
//
// The measurement is a WINDOW rather than a poll of six hundred frames: the catch
// is required to be in its bay at `FISH_LINGER - TOLERANCE` and gone by
// `FISH_LINGER + TOLERANCE`. The tolerance is the tenth of a second the review
// item names, which is `12` frames either side of the `600` the figure is worth at
// the `TICK_HZ` (`120`) `specs/overview.md` fixes.
//
// It is sampled through the wait as well, in four equal stretches, because "stays
// in the bay it appeared in" is the other half of the rule: a build whose catch
// wanders between bays and happens to be gone at the right moment is not one that
// lingered.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { FISH_LINGER, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  seconds,
  startCrossing,
  type Harness,
} from "../harness";

/** The bay the catch is posed into. */
const BAY = 3;

/** The tenth of a second the review item allows, as whole frames: `12` at `120` Hz. */
const TOLERANCE_FRAMES = Math.round(0.1 * TICK_HZ);

/** The linger itself: `FISH_LINGER` (`5` s) is `600` whole frames at `TICK_HZ`. */
const LINGER_FRAMES = Math.round(FISH_LINGER * TICK_HZ);

/** The linger, less the tolerance: the catch must still be in its bay here. */
const EARLY_FRAMES = LINGER_FRAMES - TOLERANCE_FRAMES;

/** The window it must leave within, from `EARLY_FRAMES` to the far tolerance. */
const WINDOW_FRAMES = 2 * TOLERANCE_FRAMES;

/** How many stretches the wait is sampled in, to see the catch hold its bay. */
const SAMPLES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the bonus catch in its bay for the linger, then takes it off", async () => {
  startCrossing(h);
  h.debug.setFishCadence(true);
  h.debug.setFishBay(BAY);

  assertEqual(h.snapshot().fishBay, BAY, "the posed bonus catch");

  // The wait, read at each of its four marks. The readings are collected rather
  // than asserted here so the picture below is taken whatever they hold: a build
  // whose catch left early leaves a still of the bay it left.
  const held: { at: string; bay: number | null }[] = [];
  for (let sample = 1; sample <= SAMPLES; sample += 1) {
    const target = Math.round((EARLY_FRAMES * sample) / SAMPLES);
    const done = Math.round((EARLY_FRAMES * (sample - 1)) / SAMPLES);
    await h.advance(target - done);
    held.push({ at: seconds(target).toFixed(3), bay: h.snapshot().fishBay });
  }

  captureStill(h, "fish");

  for (const reading of held) {
    assertEqual(
      reading.bay,
      BAY,
      `still in bay ${BAY} at ${reading.at} s of its linger`,
    );
  }

  const left = await h.until((s) => s.fishBay !== BAY, {
    maxFrames: WINDOW_FRAMES,
    poll: 1,
  });
  assertEqual(
    left.hit,
    true,
    `gone by ${seconds(LINGER_FRAMES + TOLERANCE_FRAMES)} s of its linger`,
  );
  assertNull(left.snapshot.fishBay, "the bay after the catch left");
});
