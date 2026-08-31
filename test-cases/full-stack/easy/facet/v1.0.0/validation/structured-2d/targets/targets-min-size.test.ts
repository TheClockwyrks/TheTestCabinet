// Facet — targets/targets-min-size: every target is big enough for a fingertip.
//
// specs/controls.md states it as two rows of the requirements table every target
// on every screen satisfies: "Width — at least `TARGET_MIN_W` (`96`)" and
// "Height — at least `TARGET_MIN_H` (`72`)", and says why: "The width and the
// height are what a fingertip needs, so every target is worked by touch as
// readily as by a mouse."
//
// A FLOOR, NEVER A SIZE. A target of exactly those dimensions conforms and so
// does one twice as large — where a target sits and how big it is beyond the
// floor is the build's design, and this case fixes not one rectangle. So the
// reading is a comparison against the two minimums and never an equality with
// them.
//
// THE FAULT THIS POINT EXISTS FOR is a build whose menu items are hit-tested as
// the bounds of their drawn TEXT. Such a build passes every behavior point in
// this category — the presses there aim at each target's own center, and a text
// bound has a center — and is unusable with a finger, which covers far more of a
// touchscreen than a cursor covers of a monitor. That is a fault no other point
// can see, which is what makes it a point.
//
// EVERY SCREEN, because the requirement is stated of every target on every
// screen and a build lays its screens out one at a time. The two on-screen
// controls are the likeliest to be drawn small, since each carries one short
// word.

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
  TARGET_MIN_H,
  TARGET_MIN_W,
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
  targetIsBigEnough,
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

afterEach(() => {
  h?.dispose();
});

/** Write every cell of a board in the notation onto the live board, `setGem` by `setGem`. */
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
      h.debug.reset();
      break;
    case "howto":
      h.debug.reset();
      h.debug.openHowTo();
      break;
    case "playing":
      loadBoard(h, openBoard());
      break;
    case "paused":
      loadBoard(h, openBoard());
      h.debug.pause();
      break;
    case "levelclear": {
      loadBoard(h, openBoard());
      h.debug.setLevel(1);
      const opened = h.snapshot();
      assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
      h.debug.setLevelScore(opened.levelTarget);
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
      loadBoard(h, openBoard());
      // `loadBoard` leaves the round's figures where they stand, and the level
      // condition is read before the end condition (specs/rules.md), so the
      // banked score is returned to nothing first. Otherwise a level score left
      // at the target by an earlier pose ends the level instead of the round.
      h.debug.setLevel(1);
      h.debug.setLevelScore(0);
      await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
      // The board goes dead under the running step, so the read at the end of
      // its hold seeds nothing and the chain ends on a board with no move on it.
      writeBoard(dead);
      await advanceStep(h);
      break;
    }
  }
  const reading = h.snapshot();
  assertEqual(
    reading.screen,
    screen,
    `the screen the poses for ${screen} reached`,
  );
  return reading;
}

it("reports every target at least TARGET_MIN_W by TARGET_MIN_H", async () => {
  for (const screen of SCREENS) {
    const reading = await reach(screen);
    assertGreaterThanOrEqual(
      reading.targets.length,
      1,
      `the targets the ${screen} screen reports, of which every one is read`,
    );

    for (const target of reading.targets) {
      assertTrue(
        targetIsBigEnough(target),
        `target ${target.id} on ${screen} measures ${target.w}x${target.h}, ` +
          `against the ${TARGET_MIN_W}x${TARGET_MIN_H} a fingertip needs`,
      );
    }

    if (screen === PICTURED) {
      // One frame, so the picture is of the screen the rectangles were read on.
      await h.advance(1);
      captureStill(h, "targets");
    }
  }
});
