// screens/advances-in-real-time — the game runs itself off a real clock.
//
// WHY THIS CHECK EXISTS. Every other check in this project steps the engine
// itself, a counted number of frames at a scripted step, and every one of them is
// blind to this claim: a build whose game moves only when something hands it a
// frame it has already decided the length of would answer them all perfectly. So
// this one alone never steps the measured stretch. It builds its harness on a
// `WallClock`, hands the game to the engine's own frame loop, lets a second of
// REAL time pass, takes the loop back, and reads what the build did with it.
//
// WHAT THE CLAIM IS UNDER THIS ENGINE. Structured 2D owns the loop and the
// clock, so what the specification puts on the BUILD is the other half:
// specs/instrumentation.md requires a render-free core whose "game state advances
// from the elapsed time the game is handed, independent of a canvas, of the frame
// loop that measured it, and of wall-clock time", and every rate integrated
// against that delta. A build that ignores the delta it is passed, or that moves
// the world only where a debug operation touched it, fails here.
//
// TWO INDEPENDENT WITNESSES. The game's own accumulated `simTime`, which says the
// build integrated the elapsed seconds it was handed, and the distance the miner
// fell, which says the SIMULATION ran rather than a counter ticking up.
//
// ISOLATION. An empty mine with the miner dropped down it at its terminal speed
// and no floor within reach, the drill gated, and nothing else in the world.

import { afterEach, beforeEach, it } from "vitest";
import { FALL_TERMINAL_EMPTY } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  WallClock,
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";

/** Where the fall starts, in an empty mine with hundreds of open rows below it. */
const COL = 16;
const START_ROW = 8;

/** The real-time window the loop is left to run for. */
const RUN_MS = 1000;

/**
 * The floor the game clock must clear, in seconds.
 *
 * A quarter of the window, deliberately generous. The claim is that the game
 * advances with the time it is handed, not that the host keeps perfect time: a
 * Node process has no frame callback, so the engine pumps off a timer, and the
 * wall clock caps a single frame at a tenth of a second — so a loaded machine
 * running few, long frames legitimately loses some of the window. What separates
 * a build that integrates its deltas from one that ignores them is not close to
 * this line: the first lands near the whole second and the second reports 0.
 */
const MIN_ADVANCE = RUN_MS / 1000 / 4;

/**
 * The floor the miner must fall, in world units. It leaves at the terminal speed
 * specs/character.md fixes for an empty bay, so even a loop managing a fifth of
 * real time carries it this far.
 */
const MIN_TRAVEL = (FALL_TERMINAL_EMPTY * (RUN_MS / 1000)) / 5;

let h: Harness;

beforeEach(async () => {
  // A wall clock, so the frames the loop runs are worth the real time they took:
  // this is the one check whose subject is a game left to run rather than stepped.
  h = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  h?.dispose();
});

it("advances on the engine's own frame loop with nothing stepping it", async () => {
  openScene(h);
  pinDrill(h);
  h.debug.setMinerPosition(minerXOn(COL), minerYOn(START_ROW));
  h.debug.setMinerVelocity(0, FALL_TERMINAL_EMPTY);
  await h.advance(1);

  const before = h.snapshot();
  assertGreaterThan(
    before.miner.vy,
    0,
    "the miner is falling before the loop is handed back",
  );

  await captureReplay(h, "running", () => h.runFor(RUN_MS));

  const after = h.snapshot();
  assertGreaterThan(
    after.simTime - before.simTime,
    MIN_ADVANCE,
    `specs/instrumentation.md: simTime accumulates the delta of every update, over ${RUN_MS}ms of real time`,
  );
  assertGreaterThan(
    after.miner.y - before.miner.y,
    MIN_TRAVEL,
    "specs/character.md: the fall runs on the frames the loop delivers",
  );
});
