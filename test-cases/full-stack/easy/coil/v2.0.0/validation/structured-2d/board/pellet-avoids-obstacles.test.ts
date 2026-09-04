// board/pellet-avoids-obstacles — no pellet the game places lands on the course.
//
// WHAT THE SPECIFICATION FIXES. specs/board.md's valid set, the set a pellet is
// "drawn from ... at a uniformly random cell", holds a cell only when all four of
// its conditions hold, and one of them is "It is not an obstacle cell."
// specs/mode.md says the same from the course's side: "An obstacle cell is never
// a valid pellet cell, so a pellet never spawns on the course. It counts against
// the valid set that decides the board-cleared win."
//
// WHY IT IS READ OVER A LONG RUN. There is no way to ask a build what its valid
// set is; the only honest reading is to make it draw a great many times and look
// at where the pellets went. The course is eighteen cells of an interior of four
// hundred and forty-eight, so a build that draws without testing the course lands
// on it about once in twenty-five draws: over the run below the chance it never
// does is under one in a hundred.
//
// SO THE RUN MAXIMIZES DRAWS RATHER THAN LENGTH. Every eat is real — the head
// enters the pellet's cell and step 5 spawns the replacement — but the chain is
// posed back to three cells before each one, so the run never fills the board and
// never has to thread the course. That keeps the valid set at almost the whole
// interior for every draw, which is the condition the claim is worded in: a build
// that excludes the course excludes it from a wide-open board too. The meal each
// tick is placed by hand with `setPellet`, which specs/instrumentation.md states
// "is not spawning one, so the generator is not drawn from and the seeded
// sequence is left where it stands" — so what is read is the build's own spawn
// and nothing else.
//
// THE COURSE IS THE BUILD'S OWN, read back off the board, because whether the
// laid course is the right eighteen cells is `board/obstacles-layout`. What this
// point asks is whether the cells a build treats as obstacles are kept out of its
// draw.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { START_CELLS } from "../constants";
import {
  ahead,
  captureReplay,
  chainFrom,
  createHarness,
  holdsCell,
  poseScene,
  type Cell,
  type CoilSnapshot,
  type Harness,
} from "../harness";

/** Eats driven, each one tick, each drawing one replacement pellet. */
const EATS = 150;

/** The chain posed before every eat. Row 8 is the row the course keeps clear. */
const HEAD: Cell = { col: 10, row: START_CELLS[0].row };

/** Cells the posed chain holds. */
const LENGTH = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Drive `EATS` real eats and keep the cell the game spawned each pellet on. */
async function drawnPellets(): Promise<Cell[]> {
  const chain = chainFrom(HEAD, "right", LENGTH);
  const meal = ahead(HEAD, "right");
  const drawn: Cell[] = [];
  for (let eat = 0; eat < EATS; eat += 1) {
    h.debug.setSnake(chain);
    h.debug.setPellet(meal.col, meal.row);
    const after: CoilSnapshot = await h.tick();
    assertEqual(
      after.screen,
      "playing",
      `the round on eat ${eat + 1} of ${EATS}`,
    );
    assertEqual(
      after.pellet === null,
      false,
      `a replacement pellet after eat ${eat + 1} of ${EATS}`,
    );
    drawn.push(after.pellet as Cell);
  }
  return drawn;
}

it("never spawns a pellet on a cell of the course", async () => {
  const laid = poseScene(h, {
    obstacles: "course",
    snake: chainFrom(HEAD, "right", LENGTH),
    dir: "right",
    pellet: null,
    pelletRespawn: true,
  });
  assertGreaterThan(
    laid.obstacles.length,
    0,
    "obstacle cells on the board of a mode that lays a course",
  );
  const course = laid.obstacles;

  const drawn = await captureReplay(h, "avoid", drawnPellets);

  for (const [index, pellet] of drawn.entries()) {
    assertEqual(
      holdsCell(course, pellet),
      false,
      `pellet ${index + 1} of ${EATS}, drawn at (${pellet.col}, ${pellet.row})`,
    );
  }
});
