// screens/advances-in-real-time — the game runs itself off its own frame loop.
//
// WHY THIS CHECK EXISTS. Every other check in this project drives the simulation
// itself, through the surface's `advance`, and every one of them is blind to this
// claim: a build whose game never moves unless something steps it would answer
// them all perfectly while a player who opened it saw a frozen mine. So this one
// alone never advances the measured stretch. It hands the game back to its own
// loop with `setAutoStep(true)`, lets a second of REAL time pass, takes the clock
// back, and reads what the build did with it.
//
// THAT IS THE WHOLE OF THE CONTRACT UNDER THIS ENGINE. Nothing outside an
// engineless build owns its loop: specs/overview.md gives the build "the frame
// loop and the delta time it measures", and specs/instrumentation.md puts
// `setAutoStep` on the surface precisely so that loop can be stopped and started
// from outside — "`setAutoStep(true)` returns it to running itself, which is how a
// build starts and how it is played."
//
// TWO INDEPENDENT WITNESSES. The game's own accumulated `simTime`, which says the
// build integrated the elapsed seconds it measured, and the distance the miner
// fell, which says the SIMULATION ran rather than a counter ticking up.
//
// ISOLATION. An empty mine with the miner dropped down it at its terminal speed
// and no floor within reach, the drill gated, and nothing else in the world.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { FALL_TERMINAL_EMPTY } from "../constants";
import {
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
 * The floor the game clock must clear, in seconds. Half the window, deliberately
 * generous: the claim is that the game advances ITSELF, not that it keeps perfect
 * time, and a build that clamps a long frame (ordinary spiral-of-death
 * protection) legally loses some. A build driving its own tick lands near 1.0; a
 * frozen one reports 0.
 */
const MIN_ADVANCE = RUN_MS / 1000 / 2;

/**
 * The floor the miner must fall, in world units. It leaves at the terminal speed
 * specs/character.md fixes for an empty bay, so even a loop managing a fifth of
 * real time carries it this far.
 */
const MIN_TRAVEL = (FALL_TERMINAL_EMPTY * (RUN_MS / 1000)) / 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances on its own frame loop with nothing stepping it", async () => {
  await openScene(h);
  await pinDrill(h);
  await h.debug.setMinerPosition(minerXOn(COL), minerYOn(START_ROW));
  await h.debug.setMinerVelocity(0, FALL_TERMINAL_EMPTY);
  await h.advance(1);

  const before = await h.snapshot();
  assertGreaterThan(
    before.miner.vy,
    0,
    "the miner is falling before the loop is handed back",
  );

  await captureReplay(h, "running", () => h.runFor(RUN_MS));

  const after = await h.snapshot();
  assertGreaterThan(
    after.simTime - before.simTime,
    MIN_ADVANCE,
    `specs/instrumentation.md: simTime accumulates the delta of every update, over ${RUN_MS}ms of real time`,
  );
  assertGreaterThan(
    after.miner.y - before.miner.y,
    MIN_TRAVEL,
    "specs/character.md: the fall runs on the build's own frame loop",
  );
});
