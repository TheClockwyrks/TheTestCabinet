// Facet — targets/targets-on-stage: every target lies wholly on the stage.
//
// The third row of specs/controls.md's requirements table: "Placement — wholly
// within the stage." The stage is the fixed `STAGE_W x STAGE_H` (`1280 x 720`)
// design surface specs/overview.md gives, origin at the top left, so a target
// lies on it when its left and top edges are at or past the origin and its right
// and bottom edges are at or before the far corner.
//
// A TARGET HANGING OFF THE STAGE IS A CONTROL A PLAYER CANNOT REACH, in whole or
// in part, however the stage is letterboxed onto the surface the game is drawn
// on. And it is SEPARATE from the size requirement, because a build can meet both
// minimums generously and still place a rectangle past the right-hand edge —
// centring a wide menu item on a stage narrower than the item, say. Neither
// point implies the other, so each is read on its own.
//
// ALL FOUR EDGES, rather than the corner the rectangle is stated by: a rectangle
// whose top-left corner is on the stage can still run off it, which is exactly
// the case a check reading the corner alone would miss.
//
// EVERY SCREEN, because the requirement is stated of every target on every
// screen and a build lays its screens out one at a time.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import {
  GRID_COLS,
  GRID_ROWS,
  SCREENS,
  STAGE_H,
  STAGE_W,
  type Screen,
} from "../constants";
import {
  deadBoard,
  hasAnyRun,
  legalSwapExists,
  parseRows,
  quietRowsWithEscape,
  swapIsLegal,
  tokenAt,
  targetIsOnStage,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import type { FacetSnapshot } from "../surface";
import {
  advanceStep,
  captureStill,
  createHarness,
  loadBoard,
  resolveChain,
  swapAndStep,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The exchange that drops the third ruby into row 4 and makes the run. */
const RUN_SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 3, row: 4 },
};

/** The screen the kept picture is taken on. */
const PICTURED: Screen = "title";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Write every cell of a board in the notation onto the live board, `setGem` by `setGem`. */
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

/** The board every scenario below opens on, and the exchange it plays. */
function openBoard(): BoardRows {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    "the scenario's exchange is legal under R1 and R3",
  );
  return posed;
}

/**
 * Bring the game to `screen` through the poses specs/instrumentation.md gives,
 * and hand back the reading taken there.
 *
 * `title` and `howto` are one pose each; `playing` is a posed board and `paused`
 * a pause on top of it. The two screens that are the END of something are reached
 * by a real chain driven to rest, because specs/rules.md evaluates the level and
 * end conditions at the return to `idle` and nowhere else: `levelclear` with the
 * level score posed at the target the round reports, `gameover` with a dead board
 * written under the holding step.
 *
 * The screen is asserted before the targets are read, so a build that never
 * reached it fails on the screen rather than on an empty target list.
 */
async function reach(screen: Screen): Promise<FacetSnapshot> {
  switch (screen) {
    case "title":
      await h.debug.reset();
      break;
    case "howto":
      await h.debug.reset();
      await h.debug.openHowTo();
      break;
    case "playing":
      await loadBoard(h, openBoard());
      break;
    case "paused":
      await loadBoard(h, openBoard());
      await h.debug.pause();
      break;
    case "levelclear": {
      await loadBoard(h, openBoard());
      await h.debug.setLevel(1);
      const opened = await h.snapshot();
      assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
      await h.debug.setLevelScore(opened.levelTarget);
      await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
      const settled = await resolveChain(h);
      assertTrue(settled.settled, "the chain returned to idle within the cap");
      break;
    }
    case "gameover": {
      const dead = deadBoard();
      assertEqual(
        legalSwapExists(dead),
        false,
        "a legal swap on the dead board",
      );
      await loadBoard(h, openBoard());
      // `loadBoard` leaves the round's figures where they stand, and the level
      // condition is read before the end condition (specs/rules.md), so the
      // banked score is returned to nothing first. Otherwise a level score left
      // at the target by an earlier pose ends the level instead of the round.
      await h.debug.setLevel(1);
      await h.debug.setLevelScore(0);
      await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
      // The board goes dead under the running step, so the read at the end of
      // its hold seeds nothing and the chain ends on a board with no move on it.
      await writeBoard(dead);
      await advanceStep(h);
      break;
    }
  }
  const reading = await h.snapshot();
  assertEqual(
    reading.screen,
    screen,
    `the screen the poses for ${screen} reached`,
  );
  return reading;
}

it("reports every target wholly inside the stage", async () => {
  for (const screen of SCREENS) {
    const reading = await reach(screen);
    assertGreaterThanOrEqual(
      reading.targets.length,
      1,
      `the targets the ${screen} screen reports, of which every one is read`,
    );

    for (const target of reading.targets) {
      assertTrue(
        targetIsOnStage(target),
        `target ${target.id} on ${screen} runs from (${target.x},${target.y}) ` +
          `to (${target.x + target.w},${target.y + target.h}), against the ` +
          `${STAGE_W}x${STAGE_H} stage`,
      );
    }

    if (screen === PICTURED) {
      // One frame, so the picture is of the screen the rectangles were read on.
      await h.advance(1);
      await captureStill(h, "targets");
    }
  }
});
