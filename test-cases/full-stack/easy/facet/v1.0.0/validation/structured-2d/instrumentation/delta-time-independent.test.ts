// Facet — instrumentation/delta-time-independent: one interval of game time
// reaches the same state however it is divided into frames.
//
// WHY THIS IS A POINT. specs/overview.md states the rule the whole simulation is
// written under — "Every rate in this specification is per second and every
// duration is in seconds, integrated against the delta time the runtime hands
// each update" — and specs/instrumentation.md turns it into the property the
// automation surface rests on: "the simulation being deterministic: every rate
// integrated against the delta time the game is given, so an interval of game
// time reaches the same state however it was divided into frames", and, of the
// clock operation itself, "`advance(1, 1)` and `advance(1, 60)` cover the same
// second of game time and must reach the same outcome". A build that counts
// FRAMES instead — a chain step every frame, or every sixteenth one, rather than
// every `STEP_SECONDS` (0.25) of accumulated game time — plays correctly on the
// machine it was written on and runs at half speed on a 30 Hz display, at double
// on a 120 Hz one. Nothing else in this project would catch that: every other
// check drives at one fixed rate, where a frame count and an elapsed time are
// the same statement.
//
// WHERE THE TWO READINGS ARE VISIBLE, AND WHERE THEY ARE NOT. They part only
// INSIDE a chain. Once a chain has run out, a build that resolved its steps a
// frame apart and a build that resolved them `STEP_SECONDS` apart have cleared
// the same cells in the same order off the same seeded refills and are sitting
// on the same settled board — the difference has been spent, and comparing two
// finished chains compares nothing. So the scenario below is a cascade six steps
// deep by construction — every one of the six is forced by R4 and R9 rather than
// dealt, and a build's own refills may carry it further still — and the interval
// is one that leaves a build integrating game time at the SECOND of those six
// however it is divided, while the fine drive's sixty frames carry a
// frame-counting build clean through all of them. A shallow chain is what
// leaves the point looking like coverage while grading nothing, which is worse
// than no check at all.
//
// THE CASCADE, AND WHY NONE OF IT IS POSED. Every step after the first is made
// by R9's settling of the step before it, so a build cannot reach step six by
// reading the posed board — it has to have run five settlings. specs/rules.md
// governs each of them, and the posed board carries no run at all:
//
//   1. The swap carries the ruby at (6,3) into (5,3), completing the rubies at
//      (3,3) and (4,3) across row 3. R3 accepts it, and it resolves on the spot.
//   2. Column 4 holds jades at rows 2, 4 and 5 — no run while the ruby at (4,3)
//      parts them. Step 1 removes that ruby, the jade at (4,2) falls into (4,3),
//      and the three jades are a maximal run down column 4.
//   3. Ambers wait at (3,4) and (5,4). Step 2 empties column 4's rows 3 to 5, so
//      the amber posed at (4,0) lands at (4,4) and row 4 carries three ambers.
//   4. Sapphires wait at (3,5) and (3,6). Step 3 removes (3,4), the sapphire
//      posed at (3,2) — already carried down to (3,3) by step 1 — falls into
//      (3,4), and column 3 carries three sapphires.
//   5. Citrines wait at (4,6) and (5,6). Step 4 empties column 3's rows 4 to 6,
//      so the citrine posed at (3,1) lands at (3,6) and row 6 carries three.
//   6. Amethysts wait at (5,7) and (5,5), with a third posed at (5,2) which
//      steps 1 and 3 have carried down to (5,4). Step 5 removes (5,6); the two
//      above it fall onto the one at (5,7), and column 5 carries three.
//
// R7 raises the strain of the gems around each clear set, so gems beside the
// cascade reach `MAX_STRAIN` as it runs and R6 draws those flawed neighbors in
// with it. That is the specification's own arithmetic, it is the same in both
// drives, and it changes nothing about the six steps: each run above is made of
// gems the settling put there, and a maximal run seeds a step whatever strain
// its gems carry.
//
// THE INTERVAL, AND WHY IT IS THIS ONE. `DRIVE_SECONDS` is `1.5` times
// `STEP_SECONDS`, so exactly one chain-step boundary falls inside it however the
// interval is divided, and it is half a step clear of both `STEP_SECONDS` and
// twice it. That margin is what makes the two drives comparable without reading
// anything the specification leaves open: a build is entitled to cross the
// boundary at `>=` or at `>`, and to carry the remainder of `stepTimer` forward
// or return it to `0` — both readings of "When `stepTimer` reaches
// `STEP_SECONDS` it returns to `0`" — and every one of those combinations
// resolves exactly one step over this interval at either frame rate. `stepTimer`
// itself is therefore not compared; the fields the point names are.
//
// WHY TWO INSTANCES. The comparison needs the same starting state twice, and the
// first drive consumes it: the same seed, the same posed board and the same
// swap, driven once coarsely and once finely, in builds that were loaded
// separately.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertNotEqual,
  assertTrue,
} from "../assert";
import {
  assertBoardEquals,
  maximalRuns,
  quietRowsWithEscape,
  renderBoard,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import { STEP_SECONDS } from "../constants";
import {
  captureReplay,
  createHarness,
  failSurface,
  loadBoard,
  swap,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

let h: Harness;

/** The seed both drives run from, so R9's refill draws the same gems in each. */
const SEED = 4242;

/**
 * The interval both drives cover, in seconds of game time.
 *
 * One and a half steps: past `STEP_SECONDS` and short of twice it by the same
 * half-step, so exactly one chain-step boundary lies inside it under every
 * reading of the boundary the specification allows.
 */
const DRIVE_SECONDS = 1.5 * STEP_SECONDS;

/** The two divisions of that interval: one whole frame, and sixty. */
const COARSE_FRAMES = 1;
const FINE_FRAMES = 60;

/**
 * The cascade, written as the cells that make each step of it.
 *
 * Nothing here is a run on the posed board — each group is parted by a gem the
 * step before it removes — and the header above walks the six steps in order.
 */
const CASCADE: PlacedToken[] = [
  // 1: the row-3 rubies, and the one the swap trades in from (6,3).
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 6, row: 3, token: "R0" },
  // 2: column 4's jades, parted by the ruby at (4,3).
  { col: 4, row: 2, token: "J0" },
  { col: 4, row: 4, token: "J0" },
  { col: 4, row: 5, token: "J0" },
  // 3: row 4's ambers, the third of them waiting at the top of column 4.
  { col: 3, row: 4, token: "A0" },
  { col: 5, row: 4, token: "A0" },
  { col: 4, row: 0, token: "A0" },
  // 4: column 3's sapphires, the third of them waiting above the row-3 ruby.
  { col: 3, row: 5, token: "S0" },
  { col: 3, row: 6, token: "S0" },
  { col: 3, row: 2, token: "S0" },
  // 5: row 6's citrines, the third of them waiting at the top of column 3.
  { col: 4, row: 6, token: "C0" },
  { col: 5, row: 6, token: "C0" },
  { col: 3, row: 1, token: "C0" },
  // 6: column 5's amethysts, parted by the citrine at (5,6).
  { col: 5, row: 7, token: "M0" },
  { col: 5, row: 5, token: "M0" },
  { col: 5, row: 2, token: "M0" },
];

/** The board the cascade is written on, with one spare swap keeping the round alive. */
const POSED = quietRowsWithEscape(CASCADE);

/** The swap that starts the chain: it completes the rubies across row 3. */
const SWAP_A: CellRef = { col: 5, row: 3 };
const SWAP_B: CellRef = { col: 6, row: 3 };

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

/** Pose the scenario on `target` and read the state the swap left. */
async function pose(target: Harness): Promise<FacetSnapshot> {
  if (target.surfaceFault !== null) failSurface(target.surfaceFault);
  await target.debug.reset({ seed: SEED });
  await loadBoard(target, POSED);
  return swap(target, SWAP_A, SWAP_B);
}

/** Drive the interval as `frames` equal frames, in a fresh instance. */
async function driveFresh(frames: number): Promise<FacetSnapshot> {
  const fresh = await createHarness({ seed: SEED });
  try {
    await pose(fresh);
    await fresh.advanceSeconds(DRIVE_SECONDS, frames);
    return await fresh.snapshot();
  } finally {
    await fresh.dispose();
  }
}

beforeEach(async () => {
  h = await createHarness({ seed: SEED });
});

afterEach(async () => {
  await h?.dispose();
});

it("reaches the same state whether the interval is one frame or sixty", async () => {
  requireSurface();

  // The fixture's own guarantees, asserted here so that anything that fails
  // below is the build's: the posed board carries no run of its own, the swap is
  // one R1 and R3 both accept, and the only run it makes is step 1's.
  assertLength(maximalRuns(POSED), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(POSED, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(
    maximalRuns(swapped(POSED, SWAP_A, SWAP_B)),
    1,
    "maximal runs the swap makes",
  );

  const opened = await pose(h);
  assertEqual(opened.phase, "resolving", "the phase the accepted swap left");
  assertEqual(opened.chainStep, 1, "the chain step the accepted swap resolved");

  // The whole interval as a single frame. Whatever the build does inside it, it
  // is handed the interval as one delta.
  await captureReplay(h, "drive", async () => {
    await h.advanceSeconds(DRIVE_SECONDS, COARSE_FRAMES);
  });
  const coarse = await h.snapshot();

  // The same interval, sixty frames of it, in a build stood up separately.
  const fine = await driveFresh(FINE_FRAMES);

  // The comparison says nothing unless the interval actually carried the chain
  // somewhere. It is longer than `STEP_SECONDS`, so the board was read again and
  // the step the swap resolved is behind both drives.
  assertNotEqual(
    coarse.chainStep,
    opened.chainStep,
    `the chain step after ${DRIVE_SECONDS}s, which is past STEP_SECONDS (${STEP_SECONDS})`,
  );

  assertBoardEquals(
    renderBoard(coarse),
    renderBoard(fine),
    `the board after ${DRIVE_SECONDS}s driven as ${COARSE_FRAMES} frame against ${FINE_FRAMES}`,
  );
  assertEqual(coarse.chainStep, fine.chainStep, "the chain step reached");
  assertEqual(coarse.phase, fine.phase, "the phase reached");
  assertEqual(coarse.score, fine.score, "the score reached");
  // Summing sixty sixtieths of the interval is not exactly the interval, so the
  // clock is compared at the precision the arithmetic itself allows and no
  // further.
  assertCloseTo(coarse.simTime, fine.simTime, 6, "the simulation time reached");
});
