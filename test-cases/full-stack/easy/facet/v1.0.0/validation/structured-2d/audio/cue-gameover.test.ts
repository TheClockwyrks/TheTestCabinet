// Facet — audio/cue-gameover: the `gameover` cue sounds on the frame the round
// ends, and on no frame before it.
//
// specs/ui.md's CUES table: "`gameover` — `CUES.gameOver` — The round ends", with
// "Each is played on the frame its event happens … and at most once on that
// frame". specs/rules.md fixes WHICH frame that is: "when `phase` returns to
// `idle` and no legal swap exists on the board, `screen` becomes `gameover`." The
// event is the chain SETTLING onto a board with no move left, not the swap that
// opened the chain and not the step that emptied the board of moves.
//
// WHAT THAT FRAME IS ENTITLED TO RAISE. It clears nothing — it is the frame a
// step's hold ended on and the board it read seeded no clear set — and it lands
// nothing, since `land` belongs to `LAND_AT`, a whole `STEP_SECONDS` earlier
// inside the hold that just ended. The level rule is held off below, so
// `gameover` is the one cue in the table that frame can answer for.
//
// HOW THE DEAD BOARD IS PUT UNDER THE SETTLING CHAIN. A chain is opened by an
// ordinary accepted swap on an ordinary live board, and then, while step 1 is
// still holding, every cell is rewritten to the board specs/rules.md's end
// condition describes: no run stands on it, no prism sits on it, and exchanging
// any two orthogonally adjacent cells leaves every line short of three of one
// kind, so R3 refuses every swap R1 would allow. specs/instrumentation.md says
// `setGem` leaves "the screen, the phase, and the selection" where they were, so
// the step keeps holding and reads this board when its hold is up. Letting a
// chain run itself out until the refill happened to go dead would leave the
// moment to R9's seeded draw, which two equally correct builds would answer
// differently; posing the dead board outright asks every build the same question,
// and puts the settling frame where the check can name it.
//
// AND IT SHORTENS THE HOLD, WHICH THE DRIVE READS RATHER THAN ASSUMES. `setGem`
// gives the cell it writes a `fell` of `0`, so a board rewritten cell by cell
// reports a `lastFall` of `0` and the `stepHold` derived from it shrinks. The
// frames left to drive are counted off the snapshot AFTER the rewrite, through
// the harness's own `stepDriveFrames`, rather than from a figure written here.
//
// THE LEVEL RULE MUST NOT BE WHAT ANSWERS. specs/rules.md states it first and
// takes precedence, so the round's `levelScore` is checked to be short of level
// 1's target while the step is still holding — the only condition left for the
// return to `idle` to meet is the board with no swap on it.
//
// The swap is posed rather than played with a pointer, because the event this
// point reads is raised by a FRAME: `requestSwap` goes "through the same
// acceptance path a player's release takes" (specs/instrumentation.md) and puts
// no pointer surface between this point and the thing it decides. The chain is
// then walked ONE FRAME AT A TIME rather than a step at a time, so the frame the
// round ended on is the frame the check reads.
//
// WHAT THIS ENGINE READS. The cue's name is the engine bus's own, so the check
// asserts that the settling frame carried `CUES.gameOver` and that no frame in
// the whole watched drive carried it before. Containment, never exclusivity:
// specs/ui.md lets a frame raise more than one cue.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThan,
  fail,
} from "../assert";
import { CUES, GRID_COLS, GRID_ROWS, LEVEL_TARGET_STEP } from "../constants";
import {
  deadBoard,
  hasAnyRun,
  legalSwapExists,
  maximalRuns,
  parseRows,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  tokenAt,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  cueNames,
  cuesOnFrame,
  loadBoard,
  requestSwap,
  stepDriveFrames,
  watchCues,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 3, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
];

/** The cell the waiting ruby sits on, and the cell the swap drops it into. */
const FROM: CellRef = { col: 5, row: 2 };
const TO: CellRef = { col: 5, row: 3 };

/**
 * Frames allowed beyond the drive a boundary needs.
 *
 * NOT a specification figure. `stepDriveFrames` is the harness's own count of the
 * frames that carry the game past the boundary it stands before, sized so a build
 * comparing `>=` and one comparing `>` both read alike; two frames beyond it is
 * room for a build that acts on the next frame, and no room for a second step.
 */
const SEARCH_MARGIN = 2;

let h: Harness;

/** Write every cell of a written board onto the live board, `setGem` by `setGem`. */
function writeBoard(rows: BoardRows): void {
  // Parsed on this side first, so a typo in the fixture fails here rather than
  // crossing into the build one cell at a time.
  parseRows(rows);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      h.debug.setGem(col, row, tokenAt(rows, col, row));
    }
  }
}

/** Run frames one at a time until `chainStep` reaches `step`, and name the frame. */
async function stepFrame(step: number): Promise<number> {
  const cap = stepDriveFrames(h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    if (h.snapshot().chainStep >= step) return h.frame();
  }
  return fail(
    `chain step ${step} within ${cap} frames of the boundary before it`,
    `phase ${h.snapshot().phase} at chain step ${h.snapshot().chainStep}`,
  );
}

/** Run frames one at a time until the chain is idle, and name the frame it was. */
async function settleFrame(): Promise<number> {
  const cap = stepDriveFrames(h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    if (h.snapshot().phase === "idle") return h.frame();
  }
  return fail(`the chain to settle within ${cap} frames`, h.snapshot().phase);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays the game-over cue on the frame the round ends", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  const dead = deadBoard();

  // Both boards are what the check claims before the build is asked anything.
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertEqual(
    swapIsLegal(posed, FROM, TO),
    true,
    "the scenario's exchange is legal under R1 and R3",
  );
  assertLength(
    maximalRuns(swapped(posed, FROM, TO)),
    1,
    "maximal runs the exchange produces",
  );
  assertEqual(hasAnyRun(dead), false, "a maximal run on the dead board");
  assertEqual(legalSwapExists(dead), false, "a legal swap on the dead board");

  // The build has to have opened its audio and decoded its produced `.wav`s
  // before a frame can be read for a cue at all.
  assertEqual(await h.warmAudio(), true, "the build ever made a sound");
  const cues = watchCues(h);

  loadBoard(h, posed);

  const ended = await captureReplay(h, "gameover", async () => {
    requestSwap(h, FROM, TO);
    const clearFrame = await stepFrame(1);
    const opened = h.snapshot();
    assertEqual(
      opened.phase,
      "resolving",
      "the phase the step that resolved left",
    );
    assertEqual(opened.screen, "playing", "the screen while the chain runs");

    // The board goes dead under the running step.
    writeBoard(dead);
    const held = h.snapshot();
    assertEqual(held.phase, "resolving", "the phase setGem left standing");
    assertEqual(held.level, 1, "the level the round is on");
    assertLessThan(
      held.levelScore,
      LEVEL_TARGET_STEP,
      "the level score against level 1's target",
    );

    return { clearFrame, at: await settleFrame() };
  });

  // The settle is a later frame than the clear, so "before it" has frames in it.
  assertGreaterThan(
    ended.at,
    ended.clearFrame,
    "the frame the round ended on, against the frame its last step cleared on",
  );

  const after = h.snapshot();
  assertEqual(after.phase, "idle", "the phase the chain ended in");
  assertEqual(
    after.screen,
    "gameover",
    "the screen the settled dead board left",
  );

  // The cue sounded on the frame the round ended.
  assertEqual(
    cueNames(cuesOnFrame(cues, ended.at)).includes(CUES.gameOver),
    true,
    "the cues on the frame the round ended",
  );

  // And on no frame before it: every game-over cue in the whole watched drive —
  // the swap's own frames, the step's, and each frame the hold ran for — is that
  // one frame.
  const early = cues
    .filter((cue) => cue.cue === CUES.gameOver && cue.frame !== ended.at)
    .map((cue) => cue.frame);
  assertDeepEqual(
    early,
    [],
    `frames other than ${ended.at} that sounded the game-over cue`,
  );
});
