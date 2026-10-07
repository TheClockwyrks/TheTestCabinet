// states/playing-resumes-after-a-round-ended — a game put back on `playing` plays
// on.
//
// specs/instrumentation.md, on `setScreen`: "The screen is the whole record of a
// round having ended, so a game moved back to `playing` plays on from the board
// as it stands and never returns itself to the screen the round ended on." And,
// of every pose: "the game carries on under its own rules from there, so ticks
// resolve on `playing`".
//
// WHAT THIS IS ABOUT, AND WHAT IT IS NOT. `no-tick-after-round-ends` decides that
// an ended round left ON its ending screen advances nothing. This decides the
// other half: that the ending is recorded by the screen and NOWHERE ELSE, so a
// build carries no second record of it that a pose cannot reach. A build holding
// one either freezes the resumed round or bounces it straight back to the screen
// it ended on, and both are read here.
//
// WHY THE ROUND IS KILLED FOR REAL. A posed `gameover` screen would prove nothing:
// a build only latches an ending on the tick that resolves it, so the ending has
// to be one the build itself reached.
//
// WHY THE BOARD IS RE-POSED BEFORE THE RESUME. The chain the death left has its
// head against a wall, so the very next tick would be fatal again and the reading
// would be about the collision rather than about the resume. The board is laid
// again through the surface's single-field operations — a safe chain, a heading
// with a clear runway, an emptied buffer, and no pellet — and the round is asked
// for exactly one tick over it. The obstacle course was already cleared when the
// death was arranged and no operation since has put it back.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  WALL_CELL,
  ahead,
  arrangeApproach,
  captureReplay,
  chainFrom,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/** The head the resumed round is laid at: mid-board, with a clear run right. */
const SAFE_HEAD: Cell = { col: 10, row: 8 };

/** How long the re-posed chain is. `specs/board.md` opens a round at three. */
const CHAIN = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resolves a tick over the board as it stands once the screen is playing again", async () => {
  arrangeApproach(h, WALL_CELL, { dir: "left" });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the death ended on");

  const played = await captureReplay(h, "playing-on", async () => {
    h.debug.setSnake(chainFrom(SAFE_HEAD, "right", CHAIN));
    h.debug.setDirection("right");
    h.debug.clearTurns();
    h.debug.clearPellet();
    h.debug.setScreen("playing");
    return h.tick();
  });

  assertEqual(played.screen, "playing", "the screen one tick after the resume");
  assertEqual(
    played.ticks,
    ended.ticks + 1,
    "ticks resolved by the one tick after the resume",
  );
  assertDeepEqual(
    played.snake[0],
    ahead(SAFE_HEAD, "right"),
    "the head one tick after the resume",
  );
});
