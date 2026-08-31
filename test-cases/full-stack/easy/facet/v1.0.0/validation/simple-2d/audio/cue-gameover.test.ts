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
// HOW THE DEAD BOARD IS PUT UNDER THE SETTLING CHAIN. A chain is opened by an
// ordinary accepted swap on an ordinary live board, and then, while step 1 is
// still holding, every cell is rewritten to the board specs/rules.md's end
// condition describes: no run stands on it, no prism sits on it, and exchanging
// any two orthogonally adjacent cells leaves every line short of three of one
// kind, so R3 refuses every swap R1 would allow. specs/instrumentation.md says
// `setGem` leaves "the screen, the phase, the cursor, and the selection" where
// they were, so the step keeps holding and reads this board when its
// STEP_SECONDS is up. Letting a chain run itself out until the refill happened
// to go dead would leave the moment to R9's seeded draw, which two equally
// correct builds would answer differently; posing the dead board outright asks
// every build the same question, and puts the settling frame where the check can
// name it.
//
// THE LEVEL RULE MUST NOT BE WHAT ANSWERS. specs/rules.md states it first and
// takes precedence, so the round's `levelScore` is checked to be short of level
// 1's target while the step is still holding — the only condition left for the
// return to `idle` to meet is the board with no swap on it.
//
// The swap is driven from the KEYBOARD, because specs/ui.md says "A cue is played
// by a frame, never by a pose of the debug surface". The chain is then walked ONE
// FRAME AT A TIME rather than a step at a time, so the frame the round ended on
// is the frame the check reads.
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
import {
  CUES,
  GRID_COLS,
  GRID_ROWS,
  LEVEL_TARGET_STEP,
  STEP_DRIVE_FRAMES,
} from "../constants";
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
 * The most frames the settle is waited for.
 *
 * NOT a specification figure: STEP_DRIVE_FRAMES is the suite's own drive past
 * `STEP_SECONDS`, and twice it leaves room for a build that reads the board a
 * frame later than the earliest conformant moment without leaving room for a
 * second chain step.
 */
const SETTLE_CAP = STEP_DRIVE_FRAMES * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

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

/** Run frames one at a time until the chain is idle, and name the frame it was. */
async function settleFrame(): Promise<number> {
  for (let n = 0; n < SETTLE_CAP; n += 1) {
    await h.advance(1);
    if (h.snapshot().phase === "idle") return h.frame();
  }
  return fail(`the chain to settle within ${SETTLE_CAP} frames`, "resolving");
}

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
    // Select the cursor's cell, then swap into the cell beside it. Each
    // `confirm` lands on a frame of its own.
    h.debug.setCursor(FROM.col, FROM.row);
    await h.advance(1);
    await h.tapAction("confirm");
    h.debug.setCursor(TO.col, TO.row);
    await h.advance(1);
    await h.tapAction("confirm");

    const swapFrame = h.frame();
    const opened = h.snapshot();
    assertEqual(opened.phase, "resolving", "the phase the accepted swap opened");
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

    return { swapFrame, at: await settleFrame() };
  });

  // The settle is a later frame than the swap, so "before it" has frames in it.
  assertGreaterThan(
    ended.at,
    ended.swapFrame,
    "the frame the round ended on, against the frame the swap was accepted on",
  );

  const after = h.snapshot();
  assertEqual(after.phase, "idle", "the phase the chain ended in");
  assertEqual(after.screen, "gameover", "the screen the settled dead board left");

  // The cue sounded on the frame the round ended.
  assertEqual(
    cueNames(cuesOnFrame(cues, ended.at)).includes(CUES.gameOver),
    true,
    "the cues on the frame the round ended",
  );

  // And on no frame before it: every game-over cue in the whole watched drive —
  // the swap's own frame, and each frame the step held for — is that one frame.
  const early = cues
    .filter((cue) => cue.cue === CUES.gameOver && cue.frame !== ended.at)
    .map((cue) => cue.frame);
  assertDeepEqual(
    early,
    [],
    `frames other than ${ended.at} that sounded the game-over cue`,
  );
});
