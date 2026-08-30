// progression/advances-in-real-time — the game runs itself off the runtime's own
// loop.
//
// WHY THIS CHECK EXISTS. Every other check in this suite drives the simulation
// itself, through `engine.advance`, which is blind to this claim: a build whose
// game never advances unless something steps it would answer all of them
// perfectly while a person who opened it saw a frozen board. So this one alone
// never calls `advance` for the measured stretch. It hands the runtime a
// `WallClock` and starts `engine.run`, which pumps frames off the host's own
// frame callback in real time, and reads what the build did with them.
//
// TWO INDEPENDENT WITNESSES, both stated by specs/progression.md: "Simulation
// time accumulates the delta of every update whatever the screen, and the phase
// timers run against that same delta, so a run left alone gives way from its
// banner to live play on the game's own clock."
//
//   1. `simTime` climbs — the build integrated the elapsed seconds it was handed.
//   2. The banner gives way to `active` — a phase TIMER ran against those same
//      seconds, rather than a counter ticking up beside a frozen game.
//
// ONE WORM STANDS ON THE BOARD, AND IT IS NOT A BYSTANDER. `startPlaying` poses
// an EMPTY board, which is safe (specs/progression.md: a level clears on the
// removal of its last segment, so a board that never held one never clears) —
// but only if the build reads that rule correctly, and a build that reads it as
// a predicate would clear the level under this scenario and leave the run back
// on a banner through no fault of its clock. `empty-board-does-not-clear` is the
// point that grades that rule, so one segment is posed here, with its step gated
// off, purely so that this point's verdict is about the loop and nothing else.
//
// THE BANNER IS POSED SHORT, DELIBERATELY. `BANNER_TIME` is `1.3` s, longer than
// the window this is willing to spend on wall-clock time, and the length of the
// banner is not what is being decided here — `level-banner` decides that against
// the real figure. What is decided is that the timer moves at all with nothing
// poking it, so the banner is posed at a length the window comfortably covers.

import { afterEach, beforeEach, it } from "vitest";
import { WallClock } from "@test-cabinet/structured-2d";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** The real-time window the loop is left to run for, in milliseconds. */
const RUN_MS = 1000;

/**
 * The seconds the posed banner has left to run when the loop is started.
 *
 * `0.4` s, comfortably inside the window: a build whose loop manages even half
 * of real time reaches it, and the `MIN_ADVANCE` floor below is the stricter of
 * the two readings, so nothing here is decided by how FAST the loop runs.
 */
const BANNER_POSED = 0.4;

/**
 * The floor the game's own clock must clear, in seconds.
 *
 * Half the window, deliberately generous: the claim is that the game advances
 * ITSELF, not that it keeps perfect time, and a build that clamps a long frame
 * (ordinary spiral-of-death protection) legally loses some. A build driving its
 * own loop lands near `1.0`; a frozen one reports `0`.
 */
const MIN_ADVANCE = RUN_MS / 1000 / 2;

/**
 * The tile the sentinel segment stands on: mid-board, well above the player band
 * (rows `18` and `19`, specs/board.md), so it is nowhere near the cursor and
 * nothing about it bears on either reading below.
 */
const SENTINEL_C = 20;
const SENTINEL_R = 6;

let h: Harness;

beforeEach(async () => {
  // A real clock, because this is the one check about real elapsed time.
  h = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  h?.dispose();
});

it("accumulates its own time and opens play with nothing stepping it", async () => {
  startPlaying(h);
  const sentinelId = poseWorm(h, SENTINEL_C, SENTINEL_R);
  h.debug.setWormStepping(sentinelId, false);
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(BANNER_POSED);

  // One frame, so the banner is on the canvas to be kept. On a wall clock this
  // is the first tick and covers no elapsed time, so the run below starts where
  // the pose left off.
  await h.advance(1);
  const before = h.snapshot();
  captureStill(h, "before");
  assertEqual(before.phase, "banner", "the phase the loop is started on");

  await h.runFor(RUN_MS);

  const after = h.snapshot();
  // The pair is the evidence: two frames of the same run, a second apart, with
  // nothing between them but the runtime's own loop. A build that never advanced
  // itself produces two identical pictures.
  captureStill(h, "after");

  assertGreaterThan(
    after.simTime - before.simTime,
    MIN_ADVANCE,
    `the seconds the game accumulated over ${RUN_MS} ms of real time`,
  );
  assertEqual(
    after.phase,
    "active",
    `the phase a ${BANNER_POSED} s banner is in after ${RUN_MS} ms of real time`,
  );
});
