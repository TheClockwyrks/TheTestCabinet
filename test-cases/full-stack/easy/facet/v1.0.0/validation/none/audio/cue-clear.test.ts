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
// gives step 1 a neighbor: it resolves `SWAP_SECONDS` after a swap that raised
// its own cue, and a build a frame out either way would leave the two cues
// arguing over one window. Step 2 shares its frame with nothing. specs/rules.md:
// "When `stepTimer` reaches `STEP_HOLD` it returns to `0` and the board is read
// again. When that board seeds a non-empty clear set under R5, `chainStep` rises
// by `1` and that step resolves in the same order." No swap, no refusal, no
// creation of a level and no end of a round happens on that frame, so the cue
// belongs to it plainly.
//
// AND NO SECOND STEP CLEARS ON THE FRAMES BETWEEN THEM. One cue in the table may
// still sound there: specs/rules.md puts the landing inside the step's own hold,
// at `LAND_AT`, which is one of the frames in that window — and only when the
// step's longest fall was more than `LAND_MIN_ROWS`. This build stands on no
// engine, so specs/ui.md fixes the cue NAMES inside its own code and nothing
// outside it can be asked which cue sounded; the window therefore cannot be read
// for `clear` alone. It is read as a COUNT against what the hold is entitled to:
// one sound when step 1's OWN reported `lastFall` earns the landing, and none at
// all when it does not. A build that sounded its clear a frame early or a frame
// late puts a sound in there over and above that allowance.
//
// THE SECOND RUN IS MADE BY THE SETTLING, NOT POSED. A swap completes three
// rubies across row 4. Column 4 already carries a jade at rows 3, 5 and 6, which
// is no run while the ruby at `(4,4)` stands between them; step 1 removes that
// ruby, R9 drops the jade at `(4,3)` into `(4,4)`, and the three jades are a
// maximal run on the board step 2 reads.
//
// WHY THE SWAP IS POSED RATHER THAN PLAYED WITH A POINTER. The event this point
// reads is raised by a FRAME rather than by an input edge: step 2 resolves when
// the step before it has held for its own span, whatever asked for the move.
// specs/instrumentation.md has `requestSwap` go "through the same acceptance path
// a player's release takes, so R1, R2, and R3 in `specs/rules.md` decide it and
// nothing is bypassed", so posing the request reaches step 2 by the same road and
// puts no pointer surface between this point and the thing it decides.
//
// WHICH FRAME EACH STEP LANDS ON IS MEASURED, NOT ASSUMED. specs/rules.md fixes
// `SWAP_SECONDS` and a step's own `STEP_HOLD`, not a frame index, and whether a
// build crosses a threshold with `>=` or `>` is its own business. So the chain is
// carried ONE FRAME AT A TIME and the frame each step raised `chainStep` on is
// read off the game.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
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
import { LAND_MIN_ROWS } from "../constants";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  loadBoard,
  requestSwap,
  stepDriveFrames,
  watchCues,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

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

/** The two cells the swap exchanges: the ruby that carries into row 4. */
const FROM: CellRef = { col: 5, row: 4 };
const TO: CellRef = { col: 6, row: 4 };

/**
 * Frames allowed beyond the drive a boundary needs, while the chain is walked one
 * frame at a time.
 *
 * NOT a specification figure. `stepDriveFrames` is the harness's own count of the
 * frames that carry the game past the boundary it is standing before — the swap
 * animation, or the step in progress — with the frame or two that covers a build
 * comparing `>=` against one comparing `>`. Two frames beyond it leaves a build
 * that reads its board on the very next frame room to, and a build slower than
 * that has a cadence fault the chain items decide rather than an audio one.
 */
const SEARCH_MARGIN = 2;

let h: Harness;

/**
 * Walk the chain one frame at a time until `chainStep` reaches `step`, and name
 * the frame it did.
 *
 * One frame at a time rather than a whole drive, because the frame a step
 * resolves on is what a cue is asserted against: a build that sounded its cue a
 * frame early or a frame late lands on a different frame here rather than inside
 * the same drive.
 */
async function stepFrame(
  step: number,
): Promise<{ frame: number; snapshot: FacetSnapshot }> {
  const cap = stepDriveFrames(await h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    const snapshot = await h.snapshot();
    if (snapshot.chainStep >= step) return { frame: h.frame(), snapshot };
    if (snapshot.phase === "idle") break;
  }
  return fail(
    `chain step ${step} within ${cap} frames of the boundary before it`,
    `phase ${(await h.snapshot()).phase} at chain step ${(await h.snapshot()).chainStep}`,
  );
}

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
  assertTrue(swapIsLegal(rows, FROM, TO), "R1 and R3 accept the swap");
  assertLength(
    maximalRuns(swapped(rows, FROM, TO)),
    1,
    "maximal runs the swap makes",
  );

  await loadBoard(h, rows);
  const cues = watchCues(h);

  const chain = await captureReplay(h, "clear", async () => {
    await requestSwap(h, FROM, TO);
    const first = await stepFrame(1);
    const second = await stepFrame(2);
    return { first, second };
  });

  // The event the cue is about really happened: the step that opened cleared a
  // set off the board.
  assertGreaterThanOrEqual(
    chain.second.snapshot.lastCleared,
    1,
    "cells the chain's second step cleared",
  );

  // The window has frames in it, so "on no frame between them" says something.
  assertGreaterThan(
    chain.second.frame,
    chain.first.frame + 1,
    "the frame step 2 resolved on, against the frame after step 1's",
  );

  // "on no frame between them", as a count against the one thing the hold is
  // entitled to: the landing step 1 owes when its own longest fall was more than
  // LAND_MIN_ROWS. Step 1's reading is what says which of the two this drive got.
  const allowed = chain.first.snapshot.lastFall > LAND_MIN_ROWS ? 1 : 0;
  assertLessThanOrEqual(
    cues.filter(
      (cue) => cue.frame > chain.first.frame && cue.frame < chain.second.frame,
    ).length,
    allowed,
    `one-shot cues on the frames between step 1 and step 2, against the ` +
      `${allowed} a step whose longest fall was ` +
      `${chain.first.snapshot.lastFall} rows is entitled to`,
  );

  // And the clearing frame made a sound.
  assertGreaterThan(
    cuesOnFrame(cues, chain.second.frame).length,
    0,
    "one-shot cues on the clearing frame",
  );
});
