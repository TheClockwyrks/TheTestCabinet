// Deepcore — core-run/only-one-sample-live: a second Sample is refused while one
// is live.
//
// `specs/mining.md`: "only one may be live at a time, whether carried or ticking
// on the ground." So the Core is drilled twice over, once with a Sample already
// in the satchel and once with one lying jettisoned, and neither may produce a
// second.
//
// The reading that decides it is the TIMER. There is one Sample flag and one
// timer, so a second extraction that was wrongly allowed shows up as the timer
// jumping back to `CORE_TIMER` rather than carrying on down from where it was
// posed. Each pass therefore poses a timer well short of the full ninety
// seconds, holds `down` on the Core for longer than an extraction takes, and
// reads a timer that has run down by about the span driven and no further.
//
// The jettisoned Sample is placed with `placeCoreSample`, which
// `specs/instrumentation.md` puts on an open tunnel cell with its timer running
// — the ground Sample this half of the rule is about, without driving a jettison
// that a different validator decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertNotNull } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  openScene,
} from "../harness";
import type { Harness } from "../harness";
import { elapse, standOnCore } from "./core-scene";

/** Well short of `CORE_TIMER`, so a restarted timer would be unmistakable. */
const POSED_TIMER = 50;

/** Longer than an extraction takes, so a refusal is a refusal rather than a wait. */
const HELD_SECONDS = 4;

/** A second of slack on a timer read across a four-second driven span. */
const TOLERANCE = 1;

/** The band the timer must land in if it merely kept running. */
const KEPT_RUNNING: readonly [number, number] = [
  POSED_TIMER - HELD_SECONDS - TOLERANCE,
  POSED_TIMER - HELD_SECONDS + TOLERANCE,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a second extraction while a Sample is carried or on the ground", async () => {
  await openScene(h);
  const posed = await standOnCore(h);

  const run = await captureReplay(h, "single", async () => {
    // Carried.
    await h.debug.setCoreCarried(true);
    await h.debug.setCoreTimer(POSED_TIMER);
    await h.hold(ACTION_KEY.down);
    await elapse(h, HELD_SECONDS);
    await h.release(ACTION_KEY.down);
    const carried = await h.snapshot();

    // On the ground: the carried one away, one placed on an open cell above the
    // chamber, and the same cut driven again.
    await h.debug.setCoreCarried(false);
    await h.debug.placeCoreSample(posed.miner.col, posed.coreRow - 1);
    await h.debug.setCoreTimer(POSED_TIMER);
    await h.hold(ACTION_KEY.down);
    await elapse(h, HELD_SECONDS);
    await h.release(ACTION_KEY.down);
    const jettisoned = await h.snapshot();

    return { carried, jettisoned };
  });

  assertEqual(
    run.carried.satchel.coreSample,
    true,
    "the one Sample still the one carried",
  );
  assertNotNull(
    run.carried.coreTimer,
    "a timer still running on the carried Sample",
  );
  assertBetween(
    run.carried.coreTimer ?? Number.NaN,
    KEPT_RUNNING[0],
    KEPT_RUNNING[1],
    "the carried Sample's timer after drilling the Core again",
  );

  assertEqual(
    run.jettisoned.satchel.coreSample,
    false,
    "nothing banked while a Sample lies on the ground",
  );
  assertNotNull(
    run.jettisoned.coreGround,
    "the ground Sample still where it was placed",
  );
  assertBetween(
    run.jettisoned.coreTimer ?? Number.NaN,
    KEPT_RUNNING[0],
    KEPT_RUNNING[1],
    "the ground Sample's timer after drilling the Core again",
  );
});
