// Wick — instrumentation/frame-is-one-tick-on-playing: on `playing`, each
// stepped frame is exactly one tick, so thirty of them raise `run.tick` by 30
// and `simTime` by `30 × TICK_DT`, and leave the accumulator as it stood.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `step(ticks)`):
// "On `playing` the update is one whole tick of `specs/world.md`, run directly
// rather than through the accumulator ... The accumulator is left as it stands
// ... `simTime` rises by `TICK_DT` per frame on every screen." The tick count is
// exact; `simTime` and the accumulator are sums of `1/60`, inexact in binary,
// so they are read to `TIMER_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, so nothing a tick does
// beyond counting can leave `playing` in the middle of the thirty. A partial
// frame is posed first through `advance`, so the accumulator holds a remainder
// that the thirty stepped frames must leave exactly where it was; a build that
// ran its steps through the accumulator would consume or grow it. The thirty
// are bracketed inside the page, because the same document leaves the build's
// own loop running in real time while the clock is held and has `simTime` rise
// by the delta of every frame it runs, so a reading taken across two crossings
// would count those frames too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotEqual } from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import {
  advanceBy,
  captureReplay,
  createHarness,
  isolate,
  stepBracketed,
  type Harness,
} from "../harness";

/** Frames stepped: thirty, as the point states. */
const FRAMES = 30;

/** A partial frame that leaves `0.02 − TICK_DT` waiting in the accumulator. */
const PARTIAL_SECONDS = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs exactly one tick per stepped frame on playing", async () => {
  await isolate(h);
  const seeded = await advanceBy(h, PARTIAL_SECONDS);
  assertNotEqual(
    seeded.accumulator,
    0,
    "a remainder waiting before the frames",
  );
  assertEqual(seeded.screen, "playing", "the screen the frames run on");

  const { before, after } = await captureReplay(h, "thirty", () =>
    stepBracketed(h, FRAMES),
  );

  assertEqual(after.screen, "playing", "the screen after the frames");
  assertEqual(
    after.run.tick - before.run.tick,
    FRAMES,
    `ticks ${FRAMES} frames ran`,
  );
  assertNear(
    after.simTime - before.simTime,
    FRAMES * TICK_DT,
    TIMER_TOL,
    `simTime ${FRAMES} frames added`,
  );
  assertNear(
    after.accumulator,
    before.accumulator,
    TIMER_TOL,
    "the accumulator, left as it stood",
  );
});
