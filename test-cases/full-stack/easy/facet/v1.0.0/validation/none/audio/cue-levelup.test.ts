// Facet — audio/cue-levelup: the `levelup` cue sounds on the frame a level is
// completed, and on no frame before it.
//
// specs/ui.md's CUES table: "`levelup` — `CUES.levelUp` — A level is completed",
// with "Each is played on the frame its event happens … and at most once on that
// frame". specs/rules.md fixes WHICH frame that is: "When `phase` returns to
// `idle` and `levelScore` is at or past the target, `level` rises by `1`,
// `levelScore` returns to `0`, and a fresh opening board is dealt." The event is
// therefore the chain SETTLING, not the swap that opened it and not the step
// that banked the points.
//
// HOW THE SETTLING FRAME IS PUT WHERE THE CHECK CAN NAME IT. `levelScore` is
// posed at level 1's target before the swap, so the level is already complete
// while the chain runs and nothing may happen until `phase` returns to `idle` —
// specs/instrumentation.md says as much of `setLevelScore`: "a level score posed
// at or past the target advances the level as the next chain settles." The swap
// is then driven from the KEYBOARD, because specs/ui.md says "A cue is played by
// a frame, never by a pose of the debug surface", and step 1 resolves on that
// frame.
//
// WHY THE BOARD IS REWRITTEN UNDER THE RUNNING STEP. R9 refills from the game's
// own seeded generator, so what drops in behind the clear is the build's
// business and could seed a second chain step — which would put another
// clearing frame between the swap and the settle and make "no frame before it"
// unreadable. So while step 1 is still holding, every cell is rewritten to the
// run-free filler, which carries a legal swap and no maximal run at all.
// specs/instrumentation.md says `setGem` leaves "the screen, the phase, the
// cursor, and the selection" where they were, so the step keeps holding and
// reads that board when its STEP_SECONDS is up: it seeds nothing, `phase`
// returns to `idle`, and the ONLY condition left to meet is the level rule. The
// filler's legal swap is what keeps the end-of-round rule out of it.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`.
// specs/rules.md completes a level when the level score reaches "the target", and
// `levelTarget` is the figure the round is playing to; what that figure ought to
// be is `levels/level-target-derived`'s point. Posing the level score at the
// target the round reports leaves this point deciding the cue alone.
//
// The chain is then walked ONE FRAME AT A TIME rather than a step at a time, so
// the frame the level rose on is the frame the check reads — a cue a build
// raised a frame early or a frame late is a different frame here, not the same
// step.
//
// WHAT THIS ENGINE READS. specs/ui.md fixes the eight cue NAMES inside an
// engineless build's own code and says nothing about how a build makes a sound,
// so no `none` check may assert which cue played; what the harness observes is
// that a sound went out and on which frame. That is enough for both halves of
// the item, because the rewritten board leaves the game NO event at all between
// the swap and the settle: the settling frame has to sound, and every frame
// between the two has to be silent. A build that raises the cue when the points
// were banked, or a frame either side of the settle, fails one half or the
// other.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  fail,
} from "../assert";
import { GRID_COLS, GRID_ROWS, STEP_DRIVE_FRAMES } from "../constants";
import {
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

afterEach(async () => {
  await h.dispose();
});

/** Write every cell of a written board onto the live board, `setGem` by `setGem`. */
async function writeBoard(rows: BoardRows): Promise<void> {
  // Parsed on this side first, so a typo in the fixture fails here rather than
  // crossing into the build one cell at a time.
  parseRows(rows);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      await h.debug.setGem(col, row, tokenAt(rows, col, row));
    }
  }
}

/** Run frames one at a time until the chain is idle, and name the frame it was. */
async function settleFrame(): Promise<number> {
  for (let n = 0; n < SETTLE_CAP; n += 1) {
    await h.advance(1);
    if ((await h.snapshot()).phase === "idle") return h.frame();
  }
  return fail(`the chain to settle within ${SETTLE_CAP} frames`, "resolving");
}

it("plays the level-up cue on the frame the level is completed", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  const quiet = quietRowsWithEscape([]);

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
  assertEqual(
    hasAnyRun(quiet),
    false,
    "a maximal run on the board written under the step",
  );
  assertEqual(
    legalSwapExists(quiet),
    true,
    "a legal swap on the board written under the step",
  );

  // The build has to have opened its audio and decoded its produced `.wav`s
  // before a frame can be read for a cue at all.
  assertEqual(await h.warmAudio(), true, "the build ever made a sound");
  const cues = watchCues(h);

  await loadBoard(h, posed);
  await h.debug.setLevel(1);

  // The target the round is playing to, read rather than reckoned.
  const standing = await h.snapshot();
  assertEqual(standing.level, 1, "the level the round stands at");
  assertGreaterThan(standing.levelTarget, 0, "the target the round reports");
  const target = standing.levelTarget;

  await h.debug.setLevelScore(target);
  const before = await h.snapshot();
  assertEqual(
    before.levelScore,
    target,
    "the level score posed at the target the round reports",
  );

  const settled = await captureReplay(h, "levelup", async () => {
    // Select the cursor's cell, then swap into the cell beside it. Each
    // `confirm` lands on a frame of its own.
    await h.debug.setCursor(FROM.col, FROM.row);
    await h.advance(1);
    await h.tapAction("confirm");
    await h.debug.setCursor(TO.col, TO.row);
    await h.advance(1);
    await h.tapAction("confirm");

    const swapFrame = h.frame();
    const opened = await h.snapshot();
    assertEqual(opened.phase, "resolving", "the phase the accepted swap opened");
    assertEqual(opened.level, 1, "the level while the chain runs");
    assertGreaterThanOrEqual(
      opened.levelScore,
      target,
      "the level score standing against the target the round reports",
    );

    // The board goes quiet under the running step, so the read that ends the
    // chain seeds nothing and the settle is the next thing that happens.
    await writeBoard(quiet);
    assertEqual(
      (await h.snapshot()).phase,
      "resolving",
      "the phase setGem left standing",
    );

    return { swapFrame, at: await settleFrame() };
  });

  // The settle is a later frame than the swap, so "before it" has frames in it.
  assertGreaterThan(
    settled.at,
    settled.swapFrame,
    "the frame the chain settled on, against the frame the swap was accepted on",
  );

  const after = await h.snapshot();
  assertEqual(after.phase, "idle", "the phase the chain ended in");
  assertEqual(after.level, 2, "the level after the chain settled");
  assertEqual(after.levelScore, 0, "the level score after the level rose");
  assertEqual(after.screen, "playing", "the screen a completed level leaves");

  // "on no frame before it" — the rewritten board leaves the game no event
  // between the swap and the settle, so those frames owe silence.
  assertLength(
    cues.filter(
      (cue) => cue.frame > settled.swapFrame && cue.frame < settled.at,
    ),
    0,
    "sounds on the frames between the accepted swap and the settle",
  );

  // And the frame the level rose on made a sound.
  assertGreaterThan(
    cuesOnFrame(cues, settled.at).length,
    0,
    "sounds on the frame the level was completed",
  );
});
