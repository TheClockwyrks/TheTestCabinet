// screens/advances-on-the-engine-frames — the game runs on the frames it is handed.
//
// WHY THIS CHECK EXISTS. Every other check in this project poses a world through
// the surface and then reads what the frames did to it, and every one of them
// would be answered by a build whose world moves only where a surface operation
// touched it. So this one poses a fall, touches the surface no further, hands the
// engine a counted run of frames at its scripted step, and reads what the build
// did with them.
//
// WHAT THE CLAIM IS UNDER THIS ENGINE. Structured 2D owns the loop and the clock, so
// what the specification puts on the BUILD is the other half:
// specs/instrumentation.md requires a render-free core whose "game state advances
// from the elapsed time the game is handed, independent of a canvas, of the frame
// loop that measured it, and of wall-clock time", and every rate integrated
// against that delta. A build that ignores the delta it is passed, or that moves
// the world only where a debug operation touched it, fails here.
//
// TWO INDEPENDENT WITNESSES. The game's own accumulated `simTime`, which says the
// build integrated the seconds the frames were worth, and the distance the miner
// fell, which says the SIMULATION ran rather than a counter ticking up. The
// frames are the harness's own tick, so the span is exactly `SECONDS` of game
// time whatever machine runs it.
//
// THE TOLERANCES. `simTime` is a pure sum of the deltas, so it is held to six
// places. The fall leaves at the terminal speed `specs/character.md` fixes for an
// empty bay and stays there, so it covers `FALL_TERMINAL_EMPTY * SECONDS` within
// the one percent the terminal-speed checks allow the cap.
//
// ISOLATION. An empty mine with the miner dropped down it at its terminal speed
// and no floor within reach, the drill gated, and nothing else in the world.

import { afterEach, beforeEach, it } from "vitest";
import { FALL_TERMINAL_EMPTY } from "../constants";
import { assertBetween, assertCloseTo } from "../assert";
import {
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  ticks,
  type Harness,
} from "../harness";

/** Where the fall starts, in an empty mine with hundreds of open rows below it. */
const COL = 16;
const START_ROW = 8;

/** The span of game time the engine is handed, in seconds, and in its own frames. */
const SECONDS = 1;
const FRAMES = ticks(SECONDS);

/** One percent of the stated speed, as the terminal-speed checks allow the cap. */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances simTime and the fall over the frames the engine hands it", async () => {
  openScene(h);
  pinDrill(h);
  h.debug.setMinerPosition(minerXOn(COL), minerYOn(START_ROW));
  h.debug.setMinerVelocity(0, FALL_TERMINAL_EMPTY);
  await h.advance(1);

  const before = h.snapshot();
  assertBetween(
    before.miner.vy,
    FALL_TERMINAL_EMPTY * (1 - TOLERANCE),
    FALL_TERMINAL_EMPTY * (1 + TOLERANCE),
    "the miner falling at its terminal speed before the frames are handed over",
  );

  // Nothing on the surface is touched from here to the read: the engine's own
  // frames are all the build is given.
  await captureReplay(h, "running", () => h.advance(FRAMES));

  const after = h.snapshot();
  assertCloseTo(
    after.simTime - before.simTime,
    SECONDS,
    6,
    `specs/instrumentation.md: simTime accumulates the delta of every update, over ${FRAMES} frames`,
  );
  assertBetween(
    after.miner.y - before.miner.y,
    FALL_TERMINAL_EMPTY * SECONDS * (1 - TOLERANCE),
    FALL_TERMINAL_EMPTY * SECONDS * (1 + TOLERANCE),
    "specs/character.md: the fall runs on the frames the engine delivers",
  );
});
