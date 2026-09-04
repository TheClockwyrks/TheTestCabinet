// Wick — clock/sim-time-accounting: `simTime` accounts for every frame.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/state.md` (`WickState`): "`simTime`: accumulated simulation time,
//     in seconds. Every frame adds its delta time, whatever the screen, the
//     menus and the overlays included." And of `accumulator`: "It grows on
//     `playing` alone ... so it holds `0` on every other screen."
//   - `specs/instrumentation.md` ("A deterministic core"): "On `playing`, each
//     frame's delta time joins the accumulator, every whole `TICK_DT` in it is
//     consumed as a tick, and the remainder waits for the next frame ... On
//     every other screen a frame ticks nothing and the accumulator holds `0`."
//   - The same file, "Snapshot shape": "`simTime` rises by the delta time of
//     every frame, whatever the screen."
//
// So on `playing`, every second a frame delivered is either a consumed tick
// or the remainder: `ticks gained × TICK_DT + accumulator = simTime gained`.
// Off `playing`, a frame ticks nothing and the accumulator is `0`, so `simTime`
// alone rises, by the frame's delta.
//
// THE DRIVE. An isolated run, every switch off. A mix of frames on `playing`,
// whole ticks and partial frames in both orders, is read against the identity
// above. Then the run is paused through the surface, which discards the
// accumulator "as on any frame that leaves `playing`", and the same mix is
// delivered on `paused`; then the title, with the mix again. Each screen's
// frames must raise `simTime` by exactly their deltas, tick nothing, and leave
// the accumulator at `0`. The clock is read against the tick each screen was
// ENTERED on rather than against `0`, because the pose sets the screen and
// leaves the run standing (`specs/instrumentation.md`, `setScreen`).
//
// TOLERANCE. `REAL_EPS` on the sums: each side is a handful of stated reals
// added together, which floating point rounds by ulps. `0` on the accumulator
// off `playing` is exact, as the specification states it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TICK_DT, TICK_MS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  type Harness,
  type WickSnapshot,
} from "../harness";

/**
 * The frames delivered on each screen, in milliseconds: partial frames on
 * both sides of a tick, whole ticks, and a frame worth more than two ticks.
 */
const FRAMES_MS: readonly number[] = [25, 7, TICK_MS, TICK_MS, 40, 3, 12];

/** The seconds those frames deliver together. */
const FRAMES_SECONDS = FRAMES_MS.reduce((sum, ms) => sum + ms / 1000, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Deliver the mix of frames and read what the last one left. */
async function deliverMix(): Promise<WickSnapshot> {
  let after = h.snapshot();
  for (const ms of FRAMES_MS) after = await h.frameOf(ms);
  return after;
}

it("accounts every frame's delta as ticks and remainder, or as simTime alone", async () => {
  const posed = isolate(h);
  const playing = await deliverMix();

  const ticksGained = playing.run.tick - posed.run.tick;
  assertNear(
    ticksGained * TICK_DT + playing.accumulator,
    playing.simTime - posed.simTime,
    REAL_EPS,
    "ticks gained × TICK_DT + accumulator on playing, against the simTime gained",
  );

  const pausedAt = poseScreen(h, "paused");
  const paused = await deliverMix();
  assertEqual(paused.screen, "paused", "the screen after frames on paused");
  assertNear(
    paused.simTime - pausedAt.simTime,
    FRAMES_SECONDS,
    REAL_EPS,
    "the simTime gained by the frames on paused",
  );
  assertEqual(
    paused.run.tick,
    pausedAt.run.tick,
    "run.tick after frames on paused",
  );
  assertEqual(paused.accumulator, 0, "accumulator after frames on paused");

  const titleAt = poseScreen(h, "title");
  const title = await deliverMix();
  captureStill(h, "accounted");

  assertEqual(title.screen, "title", "the screen after frames on title");
  assertNear(
    title.simTime - titleAt.simTime,
    FRAMES_SECONDS,
    REAL_EPS,
    "the simTime gained by the frames on title",
  );
  assertEqual(
    title.run.tick,
    titleAt.run.tick,
    "run.tick after frames on title",
  );
  assertEqual(title.accumulator, 0, "accumulator after frames on title");
});
