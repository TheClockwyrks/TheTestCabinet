// audio/cue-swap — the `swap` cue sounds on the frame a swap is accepted.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`swap` | `CUES.swap` | A
// swap is accepted", under a sentence that fixes the timing — "Each is played on
// the frame its event happens ... and at most once on that frame." specs/rules.md
// says what acceptance is: R1, R2 and R3 decide a requested swap, and "An
// accepted swap exchanges the two cells at once, sets `chainStep` to `1`, sets
// `phase` to `resolving`, and resolves step `1` immediately." So the accepting
// frame is the one that leaves `chainStep` at 1, and the cue belongs to it.
//
// WHY THE KEYBOARD IS THE ROUTE. specs/ui.md says "A cue is played by a frame,
// never by a pose of the debug surface", so a swap posed through `requestSwap`
// is entitled to raise nothing, and a check that posed one would be reading that
// entitlement rather than the build's audio. specs/controls.md's third row —
// "A cell orthogonally adjacent to the selected cell | Requests that swap and
// clears the selection" — is read against the cursor's cell for `confirm`, whose
// keys the same file fixes for a build of every engine. So one `confirm` is a
// swap that really happens inside a frame, under all three engines.
//
// WHY THE SCENARIO IS BUILT THE WAY IT IS. R3 accepts a swap only when the board
// it produces carries a maximal run, so the fixture plants one and says so in
// its own terms: `swapIsLegal` is R1 and R3 read off the WRITTEN board. Whether
// the move rules decide a swap correctly is the move items' business; here they
// are the reason an acceptance happens at all.
//
// WHAT AN ENGINELESS BUILD LETS A CHECK SEE. This build stands on no engine, so
// the whole audio layer is its own: specs/ui.md fixes the cue NAMES inside the
// build's code, and nothing outside the build can be asked which cue sounded.
// What is observable is that a sound went out and which frame started it. That
// alone decides nothing here, because the accepting frame is never silent for a
// second reason: specs/rules.md resolves step 1 "immediately", on the accepting
// frame itself, and R5 seeds that step off a board R3 has just guaranteed
// carries a run or a prism — so `clear` always sounds beside `swap` there, and a
// frame that merely made some sound would be passed by a build with no swap cue
// at all.
//
// SO THE FRAME IS READ AGAINST A CONTROL FRAME THAT SOUNDS `clear` ALONE. Once
// the swap is accepted, and while `phase` is still `resolving`, the fixture
// writes the board step 1 read back onto the game cell for cell through
// `setGem`, which specs/instrumentation.md defines as writing one cell and
// leaving "the screen, the phase, the cursor, and the selection" where they
// were. specs/rules.md then has the step boundary read that board again: "When
// that board seeds a non-empty clear set under R5, `chainStep` rises by `1` and
// that step resolves in the same order." That frame is the control, and every
// one of specs/ui.md's eight events is accounted for on it — no cell is
// selected, no swap is requested and none is refused; every gem is plain at
// strain `0`, so R7 lifts nothing to `MAX_STRAIN` and `flaw` cannot sound; the
// board's one run is exactly `MATCH_MIN` long and crosses nothing, so R8 creates
// no cut gem and `cut` cannot sound; and `phase` does not return to `idle` on
// it, so neither the level condition nor the end condition is evaluated and
// neither `levelup` nor `gameover` can sound. `clear` is the only cue that frame
// may play.
//
// WHY THE COMPARISON IS FAIR WHATEVER A CUE COSTS. A build owes one cue per
// event, not one sound per cue: specs/assets.md layers a sampled shatter body
// under the chain ladder's tone, so `clear` is legitimately more than one sound,
// and no figure fixes how many. Nothing here needs one. What the two frames may
// not differ in is what the LADDER costs, and specs/ui.md settles that: "`clear`
// sounds the chain ladder, so the tone it plays is the rung `specs/assets.md`
// gives for the step's multiplier. The rungs are that one cue's sources rather
// than events of their own." One tone, chosen by the rung — a step further up
// the ladder sounds a DIFFERENT tone, never an extra one. The control board IS
// the board step 1 read, so the two frames clear the same set off the same
// board, and whatever a build spends on `clear` it spends on both. The
// accepting frame owes that same `clear` AND `swap`, and a cue that is played
// starts at least one sound. So the accepting frame must start MORE sounds than
// the control frame.
// That is a lower bound rather than a count, which is all an engineless build
// can be held to — and it is enough: a build that never plays `swap`, or plays
// it a frame late, starts exactly as many sounds on the accepting frame as on
// the control frame, and fails here.
//
// WHAT IT STILL CANNOT SEE, AND WHAT IT LEANS ON. Which of the eight sounds
// sounded: a build that plays the `refuse` sound where `swap` belongs passes
// this, and the `simple-2d` and `structured-2d` copies of this script, where the
// engine's bus announces the name, decide that half. The control also costs this
// check two dependencies it would rather not carry, both of them named in the
// failure when they bite: a chain that never reaches a second step leaves the
// comparison nothing to read, and a build that sounded `clear` from step 2
// onward but not from step 1 would break the one thing the two frames are
// assumed to share. Neither is a swap fault, and neither is decidable apart from
// the other under this engine.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import {
  allPlainAndClean,
  assertBoardEquals,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  tokenAt,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  GRID_COLS,
  GRID_ROWS,
  MATCH_MIN,
  STEP_DRIVE_FRAMES,
} from "../constants";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";

/** The selected cell: the jade the swap carries down into row 3. */
const SELECTED: CellRef = { col: 3, row: 2 };

/** The cursor's cell, orthogonally adjacent to it and one row below. */
const NEIGHBOR: CellRef = { col: 3, row: 3 };

/**
 * Three jades over the run-free filler, so that exchanging {@link SELECTED} with
 * {@link NEIGHBOR} completes a horizontal run of jade across `(2,3)`, `(3,3)`,
 * `(4,3)` and R3 accepts the swap.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: 2, row: 3, token: "J0" },
  { col: 4, row: 3, token: "J0" },
  { col: 3, row: 2, token: "J0" },
];

/**
 * Frames driven between the arrangement and the press, over a settled board on
 * which nothing at all is happening.
 *
 * No specification figure fixes a count: any stretch of quiet frames reads the
 * same, and four is enough to tell a cue apart from a sound played every frame.
 */
const QUIET_FRAMES = 4;

/**
 * Real time given to the decoder after the audio has opened, before anything is
 * counted.
 *
 * specs/assets.md has a build decode its produced `.wav`s with the Web Audio
 * API, which is asynchronous and runs off the frame loop, and `warmAudio` waits
 * only for the FIRST sound — under specs/ui.md that is a music bed, since one of
 * the two plays on every screen. A cue whose file had not finished decoding
 * would be counted low through no fault of the build, so the decoding is waited
 * out rather than raced. No specification figure fixes a duration; this is a
 * quarter of a second of real time for files a build committed and the page has
 * already fetched.
 */
const DECODE_SETTLE_MS = 250;

/**
 * How far the chain is followed while looking for the step boundary.
 *
 * `STEP_DRIVE_FRAMES` is the harness's own "one whole step" drive, past
 * `STEP_SECONDS` whichever way a build compares it; twice that is generous
 * headroom, and a build slower than it has a cadence fault the chain items
 * decide rather than an audio one.
 */
const STEP_SEARCH_FRAMES = STEP_DRIVE_FRAMES * 2;

/** Write a whole board onto the game a cell at a time, leaving the phase alone. */
async function writeBoard(harness: Harness, rows: BoardRows): Promise<void> {
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      await harness.debug.setGem(col, row, tokenAt(rows, col, row));
    }
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays a cue on the frame the swap is accepted", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");
  await h.settle(DECODE_SETTLE_MS);

  // The fixture's own guarantees, read off the written board rather than off the
  // build: nothing on it matches, and the move rules accept the one swap planted.
  const rows = quietRowsWithEscape(SCENARIO);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(
    swapIsLegal(rows, SELECTED, NEIGHBOR),
    "R1 and R3 accept the swap",
  );

  // And the guarantees the control frame rests on, read off the same notation:
  // the board the swap produces carries one run, that run is the shortest R4
  // counts, and every gem on it is plain and unstrained. So the step that reads
  // this board clears, creates no cut gem, and flaws nothing.
  const control = swapped(rows, SELECTED, NEIGHBOR);
  const runs = maximalRuns(control);
  assertLength(runs, 1, "maximal runs on the board the swap produces");
  assertLength(runs[0].cells, MATCH_MIN, "cells in the run the swap makes");
  assertTrue(
    allPlainAndClean(control),
    "every gem on that board is plain at strain 0",
  );

  const posed = await loadBoard(h, rows);
  assertEqual(posed.phase, "idle", "the phase a swap may be requested from");
  await h.debug.setSelection(SELECTED.col, SELECTED.row);
  await h.debug.setCursor(NEIGHBOR.col, NEIGHBOR.row);

  const cues = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const frame = await captureReplay(h, "swap", async () => {
    await h.tapAction("confirm");
    return h.frame();
  });

  // The event the cue is about really happened: specs/rules.md's own evidence
  // for an accepted swap.
  const after = await h.snapshot();
  assertEqual(after.phase, "resolving", "the phase after the swap");
  assertEqual(after.chainStep, 1, "the chain step the accepted swap opened");

  // "on no frame before it" — the settled board was silent right up to the press.
  assertLength(
    cues.filter((cue) => cue.frame < frame),
    0,
    "one-shot cues on the frames before the swap was accepted",
  );

  // And the accepting frame made a sound.
  const accepting = cuesOnFrame(cues, frame).length;
  assertGreaterThan(accepting, 0, "one-shot cues on the accepting frame");

  // The control. The board step 1 read is written back while the chain still
  // stands in `resolving`, so the boundary reads exactly that board again and
  // the step it opens clears exactly what step 1 cleared — with no swap, and no
  // other event of specs/ui.md's eight, anywhere near it.
  await writeBoard(h, control);
  assertBoardEquals(
    await h.board(),
    control,
    "the board written for the control step",
  );

  // Which frame the boundary lands on is measured rather than assumed:
  // specs/rules.md fixes `STEP_SECONDS`, not a frame index, and whether a build
  // crosses it with `>=` or `>` is its own business.
  let boundary: { frame: number; cleared: number } | null = null;
  for (let driven = 0; driven < STEP_SEARCH_FRAMES; driven += 1) {
    await h.advance(1);
    const snapshot = await h.snapshot();
    if (snapshot.chainStep >= 2) {
      boundary = { frame: h.frame(), cleared: snapshot.lastCleared };
      break;
    }
    if (snapshot.phase === "idle") break;
  }
  if (boundary === null) {
    fail(
      `a second chain step within ${STEP_SEARCH_FRAMES} frames of the swap`,
      "the chain settled at step 1, or never stepped",
    );
  }

  // The control frame is a real clearing frame, so the sounds counted on it are
  // a `clear` that was actually played.
  assertGreaterThanOrEqual(
    boundary.cleared,
    1,
    "cells the control step cleared",
  );

  // Both frames sound `clear` over the same set of the same board; only the
  // accepting frame also owes `swap`.
  assertGreaterThan(
    accepting,
    cuesOnFrame(cues, boundary.frame).length,
    "one-shot cues on the accepting frame, against the control clearing frame",
  );
});
