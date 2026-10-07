// waves/speed-doubles-the-game-time — at speed 2 the game advances twice the game
// time per unit of elapsed time.
//
// specs/waves.md, Pause and speed: "The game-speed toggle sets `speed` to `1` or
// `2`, and the game time a frame advances by is that frame's elapsed time
// multiplied by `speed`, so at `2` the game advances twice the game time per unit
// of elapsed time and `simTime` gains twice as fast."
//
// ================================ THE CLOCK RULE ============================
//
// The reading is taken on the clock the player's game runs on and never through a
// step COUNT. Under this engine `engine.advance(n)` is the engine's own frame loop
// running the identical `update` a player's frame runs, with a clock object that
// answers a fixed number of milliseconds a frame, so two legs of the same number of
// frames are two legs of the same ELAPSED time — which is exactly what the rule is
// stated in. What is compared is the GAME time each leg produced from that elapsed
// time, never the frames each leg took.
//
// ============================================================================
//
// TWO READINGS OF THE SAME RATIO, AND BOTH ARE REQUIRED. `simTime` says what the
// build's clock did, and a walker's travel says what the build's SIMULATION did
// with it. A build that doubles its `simTime` and integrates its surge against the
// undoubled delta passes the first and fails the second, and it is the second a
// player sees.
//
// EACH LEG IS ITS OWN RUN. Both open from `startRun`, which resets first, and pose
// their own Mote on the same tile of the same straight open row (`waves/run.ts`),
// so the two legs differ in the game speed and in nothing else — not in where the
// unit started, not in how far along its route it was, and not in what else stood
// on the floor.
//
// THE SPEED IS POSED, NOT PRESSED. `setSpeed` "sets the game-speed toggle" and
// poses that field alone (specs/instrumentation.md). Whether the `speed` key and
// the panel's speed control reach it is `controls`' and `hud`'s business; what is
// under test here is what the setting DOES.
//
// WHAT EVERY WRONG MODEL READS. A build that ignores the toggle reads a ratio of
// `1` on both; one that doubles the frame count rather than the delta reads `1` on
// both, since both legs run the same frames here; one that squares it reads `4`;
// one that doubles the clock but not the simulation reads `2` on `simTime` and `1`
// on the travel.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  overWindow,
  startRun,
  ticksFor,
  type Harness,
  type Window,
} from "../harness";
import { poseMote } from "./run";

/** The window each leg spends, in frames of the suite's clock: a second and a half. */
const WINDOW = ticksFor(1.5);

/** What doubling the speed must multiply a leg's game time by (specs/waves.md). */
const EXPECTED_RATIO = 2;

/**
 * How far the ratio may fall from `2`.
 *
 * The two legs are the same number of frames of the same fixed clock, so a
 * conformant build's ratio is exactly `2` and needs none of this room. What the
 * allowance covers is a build that resolves a posed field on the frame after the
 * pose: one frame in `180` is `0.006` of the window, and `0.05` is nine such
 * frames. Every other reading of the rule — `1`, `4`, `0.5` — is a whole unit away.
 */
const RATIO_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Spend one window at `speed` on a fresh run, and report what the window did. */
async function legAt(speed: number): Promise<{ window: Window; mote: number }> {
  startRun(h);
  const mote = poseMote(h);
  h.debug.setSpeed(speed);
  return { window: await overWindow(h, WINDOW), mote };
}

it("gains twice the game time and walks twice as far over the same window", async () => {
  const single = await legAt(1);
  const double = await legAt(2);

  captureStill(h, "doubled");

  assertGreaterThan(
    single.window.clockGain,
    0,
    "precondition: the leg at speed 1 advanced the game at all",
  );
  assertGreaterThan(
    single.window.travel(single.mote),
    0,
    "precondition: the Mote walked at speed 1",
  );

  assertBetween(
    double.window.clockGain / single.window.clockGain,
    EXPECTED_RATIO - RATIO_TOLERANCE,
    EXPECTED_RATIO + RATIO_TOLERANCE,
    "the simTime one window gained at speed 2 over the same window at speed 1",
  );
  assertBetween(
    double.window.travel(double.mote) / single.window.travel(single.mote),
    EXPECTED_RATIO - RATIO_TOLERANCE,
    EXPECTED_RATIO + RATIO_TOLERANCE,
    "the distance the Mote walked in one window at speed 2 over the same " +
      "window at speed 1",
  );
});
