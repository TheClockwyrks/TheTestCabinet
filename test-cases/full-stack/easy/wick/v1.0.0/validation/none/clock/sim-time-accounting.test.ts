// clock/sim-time-accounting — simTime accounts for every frame, on every
// screen.
//
// WHERE THE THRESHOLD COMES FROM. specs/instrumentation.md: "`simTime` rises by
// every frame's delta time on every screen"; of `step`, "`simTime` rises by
// `TICK_DT` per frame on every screen"; of `advance`, "`simTime` rises by
// `seconds`, and on `playing` the delta joins the accumulator and every whole
// `TICK_DT` in it is consumed as a tick, the remainder waiting in
// `accumulator`. ... On any other screen the frame ticks nothing and the
// accumulator stays `0`." specs/ui.md ("What advances on each screen") says the
// same of the screens: on `playing` "the simulation, in whole ticks of
// `TICK_DT` (`1/60`) consumed from the accumulated delta time", and on every
// other screen "Nothing", with "the accumulator ... `0` on every screen but
// `playing` by every route."
//
// THE ARITHMETIC. On `playing`, every second of delta a frame delivered went
// one of two places: into a tick, or into the remainder. So over any mix of
// frames, ticks gained times `TICK_DT` plus the accumulator equals the
// `simTime` gained. The mix here is a partial frame, three whole ticks through
// `step`, a frame too short for a tick, and a frame holding three: seven
// ticks and a remainder. On `paused` and on `title` the same kinds of frames
// tick nothing, leave the accumulator at `0`, and still raise `simTime` by
// each frame's delta, `TICK_DT` for a stepped frame.
//
// WHY THE MIX IS DRIVEN IN ONE EVALUATION. The build's own loop "keeps running
// frames in real time" while the clock is held (specs/instrumentation.md,
// `setAutoStep`), and every frame is one `simTime` rises by. A frame of that
// loop landing between two crossings from this side would add a wall-clock
// delta to `simTime` that no drive here delivered, so the reading is taken
// and the frames are driven inside a single synchronous evaluation in the
// page, where nothing else runs: `simTime` before, the mix, `simTime` after.
// What is read is then exactly the frames this check ran.
//
// THE NIGHT. An isolated run with every faculty held and nothing in it. The
// two other screens are reached by `setScreen`, "exactly as the real
// transition into it" enters them.
//
// THE TOLERANCE. `ACCUMULATOR_TOL`, the `1e-9` the specification reads the
// accumulator at, on sums of a dozen frame deltas whose floating-point drift
// is of order `1e-16`. A build that lost a frame's delta is out by at least
// `0.004`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  ACCUMULATOR_TOL,
  HANDLE,
  TICK_DT,
  type ScreenName,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** A frame holding one tick and a remainder. */
const PARTIAL_FRAME = 0.025;

/** Whole ticks stepped between the partial frames. */
const STEPPED_FRAMES = 3;

/** A frame too short for a tick. */
const SHORT_FRAME = 0.004;

/** A frame holding three ticks. */
const LONG_FRAME = 0.05;

/** The delta the mix delivers, summed frame by frame. */
const MIX_DELTA =
  PARTIAL_FRAME + STEPPED_FRAMES * TICK_DT + SHORT_FRAME + LONG_FRAME;

/** The screens that tick nothing this check drives frames on. */
const HELD_SCREENS: readonly ScreenName[] = ["paused", "title"];

/** The state the mix started from, and the state it left. */
interface Mixed {
  before: WickSnapshot;
  after: WickSnapshot;
}

/** A screen's mix, with the screen it ran on. */
interface Accounting extends Mixed {
  screen: ScreenName;
}

/** The surface as the page holds it: synchronous operations on a global. */
type PageSurface = Record<string, (...args: unknown[]) => unknown>;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Drive the mix of frames inside one evaluation, reading the state either side
 * of it there, so no frame of the build's own loop lands in between.
 */
function mixOfFrames(): Promise<Mixed> {
  return h.page.evaluate(
    ([handle, partial, stepped, short, long]) => {
      const surface = (window as unknown as Record<string, PageSurface>)[
        handle
      ];
      if (surface === undefined) {
        throw new Error(`wick: window.${handle} is not installed`);
      }
      const before = surface.snapshot!() as WickSnapshot;
      surface.advance!(partial);
      surface.step!(stepped);
      surface.advance!(short);
      surface.advance!(long);
      const after = surface.snapshot!() as WickSnapshot;
      return { before, after };
    },
    [HANDLE, PARTIAL_FRAME, STEPPED_FRAMES, SHORT_FRAME, LONG_FRAME] as const,
  );
}

it("accounts every frame's delta into ticks and the remainder", async () => {
  await isolate(h);
  const played = await mixOfFrames();
  const held: Accounting[] = [];
  for (const screen of HELD_SCREENS) {
    await poseScreen(h, screen);
    held.push({ screen, ...(await mixOfFrames()) });
  }
  await captureStill(h, "accounted");

  assertEqual(
    played.before.screen,
    "playing",
    "the screen the mix of frames ran on",
  );
  const ticks = played.after.run.tick - played.before.run.tick;
  assertNear(
    ticks * TICK_DT + played.after.accumulator,
    played.after.simTime - played.before.simTime,
    ACCUMULATOR_TOL,
    "ticks gained × TICK_DT plus the accumulator, against the simTime gained on playing",
  );
  assertNear(
    played.after.simTime - played.before.simTime,
    MIX_DELTA,
    ACCUMULATOR_TOL,
    "the simTime gained on playing, against the frames' deltas",
  );

  for (const { screen, before, after } of held) {
    assertEqual(before.screen, screen, "the screen the mix of frames ran on");
    assertEqual(
      after.run.tick,
      before.run.tick,
      `run.tick after the mix of frames on ${screen}`,
    );
    assertNear(
      after.accumulator,
      0,
      ACCUMULATOR_TOL,
      `accumulator after the mix of frames on ${screen}`,
    );
    assertNear(
      after.simTime - before.simTime,
      MIX_DELTA,
      ACCUMULATOR_TOL,
      `the simTime gained on ${screen}, against the frames' deltas`,
    );
  }
});
