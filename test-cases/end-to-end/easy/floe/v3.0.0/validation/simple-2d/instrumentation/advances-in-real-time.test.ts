// instrumentation/advances-in-real-time — the game runs itself on a real wall
// clock, with nothing stepping it from outside.
//
// specs/instrumentation.md gives the clock to the engine under this engine: "The
// clock, the keyboard, and the overlay belong to the simple-2d engine ... The
// engine advances the game frame by frame and can take it off real time."
// specs/overview.md puts the loop under it: a frame reports how much time has
// elapsed and the simulation advances by the whole `TICK_DT` ticks that elapsed
// time completes. So this hands the game to the engine's own frame loop under a
// real clock and watches.
//
// THIS IS THE ONE ITEM IN THE SUITE THAT DOES NOT STEP THE GAME ITSELF, AND THAT
// IS WHY IT EXISTS. Every other point poses a strait and then drives it with
// `advance` on a `ConstantClock` that hands each frame exactly one tick, so a
// build that ignores the delta it is handed — one that steps a fixed amount per
// frame, or none at all — answers those checks in a way they accept, while a
// player who opens it sees a strait that crawls or one that is frozen.
//
// THE CLOCK IS THE POINT, SO THIS HARNESS BUILDS ITS OWN. `WallClock` is the clock
// a shipped build runs under: each frame's delta is the real time since the last.
// Under it `advance(n)` no longer means `n` ticks, which is why nothing in the
// arrangement below advances anything for its own sake — every line of it is a
// pose, and the single frame before the first still is there to paint a picture.
//
// TWO WITNESSES, BECAUSE ONE OF THEM COULD BE A COUNTER. `simTime` rising says the
// loop counted time; a released lane item's left edge changing says the loop SPENT
// it on the simulation. A build that accumulates a clock and never integrates it
// fails the second; a build whose lanes are driven from somewhere other than the
// elapsed time fails the first.
//
// NEITHER READING IS A SPEED. The wait is real wall-clock time, and how many
// frames a machine fits into it is the machine's business rather than the build's,
// so what is required is that a fraction of a second of game time arrived and that
// the vehicle moved at all. `instrumentation/tick-length` grades the tick's own
// length and `ice/lane-speeds` the figure the lane runs at; a build that merely ran
// slowly here still passes.
//
// THE STRAIT IS EMPTY BUT FOR THE WITNESS. `startCrossing` shuts the four world
// gates and clears both rosters, and the critter it leaves stands on the near
// shore, which specs/strait.md gives no lane — so nothing that happens over the
// wait can cost a life or put anything on the strait the check did not put there.

import { WallClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { ICE_LANES, TICK_DT, tileLeft } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  lastVehicle,
  startCrossing,
  vehicleOf,
  type Harness,
  type VehicleKind,
} from "../harness";

/** The lane the witness stands in, and where it starts. */
const LANE = ICE_LANES[1]; // row 12, a car lane running rightward at 2.1
const START_COL = 12;
const START_X = tileLeft(START_COL);

/**
 * How long the game is left running on its own clock, in milliseconds.
 *
 * Three quarters of a second of real time. Long enough that even a loop presenting
 * a handful of frames a second spends some of it, and short enough that the lane's
 * own motion — `2.1` tiles per second at level 1, some `50` units over the wait —
 * leaves the witness far from either edge of the strait, so nothing about where a
 * build wraps a lane can reach the reading.
 */
const REAL_MS = 750;

/**
 * The least game time that must have arrived over that wait, in seconds.
 *
 * Six ticks, a twentieth of a second. This is not a frame-rate requirement: a loop
 * presenting six frames in three quarters of a second would clear it, and a real
 * browser presents dozens. What it excludes is a build that spent NONE of the wait
 * — one whose loop never advances the simulation, which is the defect this point
 * is about.
 */
const MIN_SIM = 6 * TICK_DT;

/**
 * The least the witness must have been carried over that wait, in stage units.
 *
 * One unit, a thirty-second of a tile. The lane runs at `2.1` tiles per second
 * (specs/ice.md), so a conforming build carries it some fifty; this is a reading
 * that the elapsed time reached the lanes rather than a demand for any particular
 * speed.
 */
const MIN_TRAVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  h?.dispose();
});

it("advances the simulation on its own clock while real time passes", async () => {
  startCrossing(h);

  // One vehicle, in the lane the level laid out — `startCrossing` clears the
  // rosters but leaves each lane's own motion, so this one is running at the speed
  // and direction specs/ice.md gives row 12 at level 1.
  h.debug.addVehicle(LANE.row, LANE.kind as VehicleKind, START_X);
  const witness = lastVehicle(h.snapshot()).id;

  // One frame, so the canvas holds a drawn picture before the first still. Under
  // `WallClock` this frame's delta is the time since the clock's first reading,
  // which is why nothing is measured across it.
  await h.advance(1);
  // The strait as the wait begins.
  captureStill(h, "before");
  const before = h.snapshot();
  const beforeX = vehicleOf(before, witness).x;

  assertEqual(
    before.screen,
    "playing",
    "the crossing is live before the clock is handed back, so there is " +
      "something running to observe",
  );

  // The measurement: real wall-clock time, with the game handed to the engine's
  // own frame loop and nothing stepping it from here.
  await h.runFor(REAL_MS);

  const after = h.snapshot();
  const afterX = vehicleOf(after, witness).x;
  // And the strait the wait left behind.
  captureStill(h, "after");

  assertGreaterThan(
    after.simTime - before.simTime,
    MIN_SIM,
    `the seconds of simulation time that arrived over ${REAL_MS} ms of real ` +
      `time with the engine's own frame loop running and nothing stepping the ` +
      `game from outside`,
  );
  assertGreaterThan(
    Math.abs(afterX - beforeX),
    MIN_TRAVEL,
    `the stage units the vehicle on ice row ${LANE.row} was carried over that ` +
      `same wait — a build that counts elapsed time without spending it on the ` +
      `strait moves it none`,
  );
});
