// Facet — targets/targets-reported: every screen reports the pointer targets
// specs/controls.md names for it, under those ids and in that order.
//
// specs/controls.md gives the table outright: `title` carries `menu-0` and
// `menu-1`, "one per entry of `TITLE_ITEMS`"; `howto` carries `back`; `playing`
// carries `pause`; and `paused`, `levelclear` and `gameover` each carry `menu-0`
// and `menu-1`, one per entry of their own item lists.
// specs/instrumentation.md's snapshot shape says where they are read: "`targets`
// lists the current screen's pointer targets, under the ids and in the order
// `specs/controls.md` fixes for that screen."
//
// THIS IS THE POINT EVERY OTHER ONE IN THE CATEGORY RESTS ON, which is what the
// `broken` cap says. A target's RECTANGLE is the build's to design — the case
// fixes not one of them — so every geometry point here reads the reported
// rectangles, and every behavior point presses at the center of one. A build that
// reports none of them is unreadable on all of it, and a player with only a
// pointer cannot reach a single screen.
//
// THE IDS ARE ASSERTED IN ORDER, not as a set. `menu-<i>` is defined by its index
// into the screen's item list — specs/controls.md: "A `menu-<i>` target covers
// the drawn menu item that `state.menuIndex` `i` highlights" — so a build that
// reported the pair the other way round would highlight `QUIT` when the pointer
// is over `RESUME`, and take the wrong one on the release. The order is the
// claim, so the order is what is read.
//
// HOW EACH SCREEN IS REACHED. Through the poses specs/instrumentation.md gives
// for it, so nothing here depends on a menu's ordering or on a key binding:
// `reset` for the title, `openHowTo`, a posed board for `playing`, `pause` on top
// of it, and — for the two screens that are the END of something — a real chain
// driven to rest, with the level score posed at the target the round reports for
// `levelclear` and a dead board written under the holding step for `gameover`.
// specs/rules.md evaluates both of those conditions at the return to `idle` and
// nowhere else, so a chain is the only honest way to either.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
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

/**
 * The ids specs/controls.md names for each screen, in the order that file lists
 * them.
 *
 * The two-item menus are written out rather than derived from the item lists, so
 * this table is the specification's sentence copied down and a check reading it
 * is not reading a derivation of the case's own.
 */
const EXPECTED: Readonly<Record<Screen, readonly string[]>> = {
  title: ["menu-0", "menu-1"],
  howto: ["back"],
  playing: ["pause"],
  paused: ["menu-0", "menu-1"],
  levelclear: ["menu-0", "menu-1"],
  gameover: ["menu-0", "menu-1"],
};

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

it("reports exactly the ids specs/controls.md names for each screen", async () => {
  for (const screen of SCREENS) {
    const reading = await reach(screen);
    assertDeepEqual(
      reading.targets.map((target) => target.id),
      EXPECTED[screen],
      `the target ids the ${screen} screen reports, in order`,
    );

    if (screen === "title") {
      // One frame, so the picture is of the title screen the ids were read on.
      await h.advance(1);
      captureStill(h, "targets");
    }
  }
});
