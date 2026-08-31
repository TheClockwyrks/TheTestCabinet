// audio/cue-clear — the `clear` cue sounds on the frame a chain step clears its
// set.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`clear` | `CUES.clear` | A
// chain step clears its set", under a sentence that fixes the timing — "Each is
// played on the frame its event happens ... and at most once on that frame."
// The same file adds that "`clear` sounds the chain ladder, so the tone it plays
// is the rung specs/assets.md gives for the step's multiplier. The rungs are
// that one cue's sources rather than events of their own" — so the rung a step
// picks is a source of this one cue, and what is asserted here is the cue, not
// the source.
//
// THE STEP THAT IS READ IS THE SECOND, AND THAT IS THE POINT. specs/rules.md
// resolves step 1 the instant a swap is accepted, so step 1's clear shares a
// frame with the acceptance. Step 2 shares its frame with nothing: "`stepTimer`
// ... accumulates game time while `phase` is `resolving`. When `stepTimer`
// reaches `STEP_SECONDS` it returns to `0` and the board is read again. When
// that board seeds a non-empty clear set under R5, `chainStep` rises by `1` and
// that step resolves". No swap, no refusal and no level change happens on that
// frame, so the sound it makes is this cue — which is what makes the item
// readable under this engine at all, where the harness reports one-shots without
// a name because specs/ui.md fixes the cue NAMES inside an engineless build's
// own code and no bus outside it can be asked.
//
// THE SECOND RUN IS MADE BY THE SETTLING, NOT POSED. A swap completes three
// rubies across row 4. Column 4 already carries a jade at rows 3, 5 and 6, which
// is no run while the ruby at `(4,4)` stands between them; step 1 removes that
// ruby, R9 drops the jade at `(4,3)` into `(4,4)`, and the three jades are a
// maximal run on the board step 2 reads.
//
// WHY THE SWAP IS MADE FROM THE KEYBOARD. specs/ui.md says "A cue is played by a
// frame, never by a pose of the debug surface", so a swap posed through
// `requestSwap` would put step 1 in no frame at all and leave a build free to
// sound it on whichever frame came next — which is exactly the window this check
// requires to be silent. Driving the swap with `confirm`, whose keys
// specs/controls.md fixes for a build of every engine, puts step 1 inside a
// frame of its own and leaves the window between the steps genuinely empty.
//
// WHICH FRAME STEP 2 LANDS ON IS MEASURED, NOT ASSUMED. specs/rules.md fixes
// STEP_SECONDS, not a frame index, and whether a build crosses it with `>=` or
// `>` is its own business. So the chain is carried one frame at a time and the
// frame that raised `chainStep` is read off the game.

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
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import { STEP_DRIVE_FRAMES } from "../constants";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";

/** Step 1's run across row 4, and the amethyst the swap trades out of it. */
const STEP_ONE: readonly PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

/**
 * The jades step 2 clears — no run while the ruby at `(4,4)` parts them, and a
 * column of three the moment step 1 has removed it and R9 has closed the gap.
 */
const STEP_TWO: readonly PlacedToken[] = [
  { col: 4, row: 3, token: "J0" },
  { col: 4, row: 5, token: "J0" },
  { col: 4, row: 6, token: "J0" },
];

/** The selected cell, and the cursor's: the swap that carries a ruby into row 4. */
const SELECTED: CellRef = { col: 5, row: 4 };
const NEIGHBOR: CellRef = { col: 6, row: 4 };

/**
 * How far the chain is followed while looking for the step boundary.
 *
 * `STEP_DRIVE_FRAMES` is the harness's own "one whole step" drive, past
 * STEP_SECONDS whichever way a build compares it; twice that is generous
 * headroom, and a build slower than it has a cadence fault the chain items
 * decide rather than an audio one.
 */
const STEP_SEARCH_FRAMES = STEP_DRIVE_FRAMES * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays a cue on the frame the chain's second step clears its set", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The fixture's own guarantees, read off the written board: nothing on it
  // matches, the move rules accept the swap, and the swap makes exactly one run.
  const rows = quietRowsWithEscape([...STEP_ONE, ...STEP_TWO]);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(
    swapIsLegal(rows, SELECTED, NEIGHBOR),
    "R1 and R3 accept the swap",
  );
  assertLength(
    maximalRuns(swapped(rows, SELECTED, NEIGHBOR)),
    1,
    "maximal runs the swap makes",
  );

  await loadBoard(h, rows);
  await h.debug.setSelection(SELECTED.col, SELECTED.row);
  await h.debug.setCursor(NEIGHBOR.col, NEIGHBOR.row);

  // Step 1, inside a frame of its own. Everything that frame sounds belongs to
  // the acceptance and to step 1, and is deliberately outside the window below.
  await h.tapAction("confirm");
  assertEqual(
    (await h.snapshot()).chainStep,
    1,
    "the chain step the swap opened",
  );

  // The window opens here: from the frame after the swap to the frame step 2
  // resolves on, specs/rules.md gives the game no event at all.
  const cues = watchCues(h);

  const boundary = await captureReplay(h, "clear", async () => {
    for (let driven = 0; driven < STEP_SEARCH_FRAMES; driven += 1) {
      await h.advance(1);
      const snapshot = await h.snapshot();
      if (snapshot.chainStep >= 2) return { frame: h.frame(), snapshot };
      if (snapshot.phase === "idle") return null;
    }
    return null;
  });
  if (boundary === null) {
    fail(
      `a second chain step within ${STEP_SEARCH_FRAMES} frames of the swap`,
      "the chain settled at step 1, or never stepped",
    );
  }

  // The event the cue is about really happened: the step that opened cleared a
  // set off the board.
  assertGreaterThanOrEqual(
    boundary.snapshot.lastCleared,
    1,
    "cells the chain's second step cleared",
  );

  // "on no frame before it" — nothing happens between the two steps, so nothing
  // sounds there either. The window is read without a name because an engineless
  // build publishes none, so any one-shot landing in it is a cue played off the
  // frame its event happened on, whichever of the eight it was.
  assertLength(
    cues.filter((cue) => cue.frame < boundary.frame),
    0,
    "one-shot cues on the frames between step 1 and step 2",
  );

  // And the clearing frame made a sound.
  assertGreaterThan(
    cuesOnFrame(cues, boundary.frame).length,
    0,
    "one-shot cues on the clearing frame",
  );
});
