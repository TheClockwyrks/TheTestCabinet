// progression/advances-in-real-time — the game runs itself off the runtime's own
// frame loop.
//
// WHY THIS CHECK EXISTS. Every other check in this suite steps the simulation
// itself, through `engine.advance`, which is blind to this claim: a build whose
// game never advances unless something steps it would answer all of them
// perfectly while a player who opened it watched a frozen board. So this one alone
// never steps the game for the measured stretch. It hands the runtime a
// `WallClock` and starts `engine.run`, which pumps frames off the host's own frame
// callback in real time, and then reads what the build did with them.
//
// THE RULE. `specs/progression.md`, *The three phases of play*: *simulation time
// accumulates the delta of every update whatever the screen, and the phase timers
// run against that same delta, so a run left alone gives way from its banner to
// live play on the game's own clock*.
//
// TWO WITNESSES, AND BOTH ARE THE SAME CLAIM. The game's own `simTime`, which says
// the build integrated the elapsed seconds it was handed, and the `banner` phase
// giving way to `active`, which says a TIMER ran against those same seconds rather
// than a counter ticking up beside a frozen game. A build that advances neither
// fails both; a build that accumulates time without running its timers fails the
// second.
//
// The run is posed on a fresh level banner over an empty board, and the worm-entry
// gate is left on so that the banner gives way to live play as it does in a real
// run — which is what the second still shows. Nothing is asserted about the worm:
// what it enters and when is `worm.enters-top-row` and
// `progression.respawn-spawns-worm`, and it is here as evidence for the reviewer
// rather than as part of the verdict.

import { afterEach, beforeEach, it } from "vitest";
import { WallClock } from "@clockwyrks/simple-2d";
import { BANNER_TIME } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * The real-time window the loop is left to run for, in milliseconds.
 *
 * Comfortably more than twice `BANNER_TIME` (`1.3` s), so a build that manages
 * only half of it in simulated time still has the whole banner to give way in.
 */
const RUN_MS = 3000;

/**
 * The floor the game's own clock must clear over that window, in seconds.
 *
 * Half of it, deliberately generous: the claim is that the game advances ITSELF,
 * not that it keeps perfect time, and a build that clamps a long frame — ordinary
 * spiral-of-death protection, which the runtime's own `WallClock` does at a tenth
 * of a second — legally loses some. A build driving its own frames lands near the
 * whole window; a frozen one reports `0`. It is also above `BANNER_TIME`, so a
 * build that clears this floor has been handed enough seconds for the banner
 * reading below to be about the build rather than about the host.
 */
const MIN_ADVANCE = RUN_MS / 1000 / 2;

let harness: Harness;

beforeEach(async () => {
  // A real clock, because this is the one check about real elapsed time.
  harness = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  harness?.dispose();
});

it("advances on the runtime's frame loop with nothing stepping it", async () => {
  const { debug } = harness;
  startPlaying(harness);
  // A level that has just opened: its banner up, with its whole timer to run.
  debug.setPhase("banner");
  debug.setPhaseTimer(BANNER_TIME);
  // Left on so the banner gives way to live play, as it does in a real run.
  debug.setWormEntry(true);

  // One frame, so the banner is on the canvas before the window opens. The
  // `WallClock`'s first tick reports no elapsed time, so this costs the run
  // nothing.
  await harness.advance(1);
  captureStill(harness, "before");
  const before = harness.snapshot();

  await harness.runFor(RUN_MS);

  // The pair is the evidence: two frames of the same run, three seconds apart,
  // with nothing between them but the runtime's own loop. A build that never
  // advanced itself produces two identical pictures.
  captureStill(harness, "after");
  const after = harness.snapshot();

  assertGreaterThanOrEqual(
    after.simTime - before.simTime,
    MIN_ADVANCE,
    "seconds of simulation over a 3 s window",
  );
  assertEqual(after.phase, "active", "phase once the banner's time had passed");
});
