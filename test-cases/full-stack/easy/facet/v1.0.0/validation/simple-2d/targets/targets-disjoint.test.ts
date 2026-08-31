// Facet — targets/targets-disjoint: no two targets on one screen overlap.
//
// The fourth row of specs/controls.md's requirements table: "Separation — no two
// targets on one screen overlap." That file then leans on the property when it
// says how a screen is operated: "A pointer position lies in at most one target,
// since no two on a screen overlap." So the requirement is what makes every rule
// below it well defined — a press in an overlap would arm two targets, and the
// specification says which one only because there cannot be one.
//
// A FAULT THE BEHAVIOR POINTS CANNOT SEE. Every press and release in this
// category aims at a target's own CENTER, and two menu rows can overlap along
// their inner edges while both centers still lie in one rectangle alone. So a
// build whose rows are stacked too closely answers `hover-highlights-menu`,
// `press-arms-target` and `release-takes-target` and leaves a band across the
// menu where a press has no defined answer.
//
// SHARING AN EDGE IS NOT OVERLAPPING. `board.ts`'s `targetsOverlap` is strict on
// every edge, so two targets laid exactly edge to edge are separate: a shared
// boundary line has no area, and the sentence the requirement exists for — a
// position lies in at most one target — is not put at risk by it in any build
// that hit-tests a half-open rectangle.
//
// EVERY PAIR ON EVERY SCREEN, because the requirement is about pairs and a build
// lays its screens out one at a time. A screen carrying one target has no pair
// and passes, which is correct: `howto` and `playing` are single-target screens
// and `targets/targets-reported` is what says so.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import { GRID_COLS, GRID_ROWS, SCREENS, type Screen } from "../constants";
import {
  deadBoard,
  hasAnyRun,
  legalSwapExists,
  parseRows,
  quietRowsWithEscape,
  swapIsLegal,
  tokenAt,
  targetsOverlap,
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
const PICTURED: Screen = "paused";

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

it("reports no two targets on one screen sharing any area", async () => {
  for (const screen of SCREENS) {
    const reading = await reach(screen);
    assertGreaterThanOrEqual(
      reading.targets.length,
      1,
      `the targets the ${screen} screen reports, of which every one is read`,
    );

    for (let i = 0; i < reading.targets.length; i += 1) {
      for (let j = i + 1; j < reading.targets.length; j += 1) {
        const a = reading.targets[i];
        const b = reading.targets[j];
        assertEqual(
          targetsOverlap(a, b),
          false,
          `targets ${a.id} at (${a.x},${a.y}) ${a.w}x${a.h} and ${b.id} at ` +
            `(${b.x},${b.y}) ${b.w}x${b.h} on ${screen} sharing area`,
        );
      }
    }

    if (screen === PICTURED) {
      // One frame, so the picture is of the screen the rectangles were read on.
      await h.advance(1);
      captureStill(h, "targets");
    }
  }
});
