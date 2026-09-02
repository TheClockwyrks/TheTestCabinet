// Meltdown — instrumentation/deterministic-core: the simulation advances on
// elapsed time alone.
//
// `specs/instrumentation.md`, A deterministic core: "every rate integrated
// against the game time each frame advances by, so an interval of game time
// reaches the same state however it was divided into frames", and "Game state
// advances from the elapsed time the game is handed, independent of a canvas, of
// the frame loop that measured it, and of wall-clock time." `specs/waves.md` says
// the same of the run: "The game advances by the elapsed time of every frame ...
// and `simTime` accumulates it, so an interval of game time reaches the same
// state however it was divided into frames."
//
// SO THE READING IS ONE SECOND, DELIVERED TWO WAYS. Two harnesses are built over
// two clocks — one whose frame is a whole second, one whose frame is a hundred and
// twentieth of one — and each is given exactly one second of game time: one frame
// of the first, a hundred and twenty of the second. The specification says both
// must land in the same place.
//
// THE CLOCK IS THE ONLY DIFFERENCE. Both harnesses open with the same `reset`,
// the same empty floor and the same walker on the same tile, and neither is
// touched while it runs. Nothing in the scenario draws — no wave is released, and
// the vent is the game's only draw (`specs/waves.md`) — so the generator cannot
// separate them either. `ConstantClock` hands the engine exactly the
// delta it was built with, so what the two runs differ by is the DIVISION of the
// second and nothing else.
//
// TWO READINGS, BECAUSE ONE OF THEM CANNOT FAIL ALONE. `simTime` alone would pass
// a build that accumulated the elapsed time faithfully while moving its units a
// fixed step per FRAME — the classic way a simulation comes to read the frame
// loop rather than the clock, and the one that makes a game play differently on a
// fast machine. So the second reading is a unit's position, and it is taken on an
// OPEN ROW: `specs/floor.md` puts the left vent and the right exhaust on the same
// four rows, so a walker on one of them with nothing built crosses in a straight
// line — no turn, no diagonal, and nothing a step size could round differently.
// A build that moved per frame reads a hundred and twenty times the travel in the
// fine-grained run.
//
// THE FRAME COUNT IS THE ONLY THING THE TWO RUNS DISAGREE ABOUT, so this is also
// the point that says the simulation reads nothing from the renderer: the coarse
// run drew one frame and the fine one drew a hundred and twenty, and the floor
// they leave behind is the same floor.

import { afterEach, beforeEach, it } from "vitest";
import { ConstantClock } from "@test-cabinet/structured-2d";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  TICK_MS,
  type Harness,
} from "../harness";
import { OPEN_ROW, poseWalkerAt, readUnit } from "./ground";

/** The interval both runs cover, in seconds. */
const INTERVAL = 1;

/** How many frames the fine-grained run divides that interval into. */
const FINE_FRAMES = Math.round((INTERVAL * 1000) / TICK_MS);

/**
 * How far the two runs' `simTime` may differ, in seconds.
 *
 * Both cover exactly one second, so a conformant build reports `1.0` twice over
 * and the only difference it can introduce is the float error of summing a
 * hundred and twenty twelfths of a tenth. A microsecond is many orders of
 * magnitude above that, and eight orders below the whole second a build that
 * counted frames instead would be out by.
 */
const CLOCK_TOLERANCE = 1e-6;

/**
 * How far the two runs' walker may differ, in logical units.
 *
 * The row is straight, so a build that integrates its speed against the frame's
 * game time arrives at the same point either way to within float error. Half a
 * logical unit is a fortieth of the `19`-unit tile `specs/floor.md` fixes —
 * generous against any accumulation error, and a hundredth of the `60` logical
 * units `specs/surge.md` gives a Mote in a second, which is the scale of the
 * disagreement a per-frame build produces.
 */
const POSITION_TOLERANCE = 0.5;

/**
 * The least distance the interval must carry the walker, in logical units.
 *
 * A dead floor agrees with itself perfectly, so the comparison above means
 * nothing until both runs are known to have MOVED. `specs/surge.md` gives the
 * Mote `60` logical units per second, and the interval is one whole second, so a
 * quarter of that is the floor: high enough that a build inching a walker a
 * twentieth of a tile cannot satisfy it, and still far enough below `60` that it
 * decides nothing about the speed, which is `surge.*`'s question. It is the same
 * quarter-of-the-specified-figure floor the engineless project's copy of this
 * point holds.
 */
const MIN_TRAVEL = 15;

/** A harness whose frame is `ms` of game time, posed with one walker on an open row. */
async function walkerOn(ms: number): Promise<{ h: Harness; id: number }> {
  const harness = await createHarness({ clock: new ConstantClock(ms) });
  startRun(harness);
  const id = poseWalkerAt(harness, "mote", OPEN_ROW);
  return { h: harness, id };
}

let coarse: Harness | undefined;
let fine: Harness | undefined;

beforeEach(() => {
  coarse = undefined;
  fine = undefined;
});

afterEach(() => {
  coarse?.dispose();
  fine?.dispose();
});

it("reaches the same simTime and the same position whether a second is one frame or a hundred and twenty", async () => {
  const oneFrame = await walkerOn(INTERVAL * 1000);
  coarse = oneFrame.h;
  const manyFrames = await walkerOn(TICK_MS);
  fine = manyFrames.h;

  const startedCoarse = readUnit(
    coarse.snapshot(),
    oneFrame.id,
    "the walker posed on the coarse clock",
  ).x;
  const startedFine = readUnit(
    fine.snapshot(),
    manyFrames.id,
    "the walker posed on the fine clock",
  ).x;

  await coarse.advance(1);
  captureStill(coarse, "advanced");
  await fine.advance(FINE_FRAMES);

  const afterCoarse = coarse.snapshot();
  const afterFine = fine.snapshot();
  const walkedCoarse = readUnit(
    afterCoarse,
    oneFrame.id,
    "the walker after one whole-second frame",
  );
  const walkedFine = readUnit(
    afterFine,
    manyFrames.id,
    `the walker after ${FINE_FRAMES} frames`,
  );

  // Both really ran: a floor that never moved would agree vacuously.
  assertGreaterThan(
    walkedCoarse.x - startedCoarse,
    MIN_TRAVEL,
    "the logical units the second carried the walker, as one frame",
  );
  assertGreaterThan(
    walkedFine.x - startedFine,
    MIN_TRAVEL,
    `the logical units the second carried the walker, as ${FINE_FRAMES} frames`,
  );

  assertLessThan(
    Math.abs(afterCoarse.simTime - INTERVAL),
    CLOCK_TOLERANCE,
    "the simTime one whole-second frame added",
  );
  assertLessThan(
    Math.abs(afterFine.simTime - INTERVAL),
    CLOCK_TOLERANCE,
    `the simTime ${FINE_FRAMES} frames of the same second added`,
  );
  assertLessThan(
    Math.abs(walkedCoarse.x - walkedFine.x),
    POSITION_TOLERANCE,
    "the logical units the two divisions of the same second left between them",
  );
  assertLessThan(
    Math.abs(walkedCoarse.y - walkedFine.y),
    POSITION_TOLERANCE,
    "the logical units across the row the two divisions left between them",
  );
});
