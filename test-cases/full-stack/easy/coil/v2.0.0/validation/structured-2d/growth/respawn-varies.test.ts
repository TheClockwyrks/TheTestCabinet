// growth/respawn-varies — the respawn cell is drawn rather than fixed.
//
// specs/board.md: "A pellet spawns at a uniformly random cell drawn from the
// valid set." A build that always answers the same cell satisfies every other
// rule of the valid set and makes an unplayable game: the route from one pellet
// to the next never changes, so the combo that specs/scoring.md builds the game
// around is a memorised loop.
//
// WHAT IS READ, AND WHY IT IS NOT A DISTRIBUTION. Randomness cannot be decided
// from a sample without a statistic, and a statistic over a build's own draws
// would fail a conformant build now and then. What the specification supports
// without qualification is that the draw MOVES: over twenty draws, the cells
// answered are not all one cell. That is the failure worth naming, and a build
// drawing uniformly from a valid set of hundreds of cells lands twenty draws on
// one cell with a probability far too small to ever cost it the point.
//
// HOW THE DRAW IS REACHED. specs/instrumentation.md gives the surface
// `drawPelletCell`, "the draw and nothing else": a reading that performs the
// spawn's draw on the board as it stands and changes nothing. So one board is
// posed, holding a short chain, no pellet, and nothing posed for the spawn, and
// the draw is read off it twenty times with no eat, no tick, and no spawn in
// between. A build whose draw is right but whose eat is broken passes here and
// fails the `growth` points about the eat, which is the separation a grade
// needs. A draw that answers no cell on a board full of free cells is a fault
// of the reading, and is named as one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull } from "../assert";
import type { Cell } from "../constants";
import {
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** Draws read off the one posed board. */
const DRAWS = 20;

/** The head of the short chain the board holds, well inside the interior. */
const HEAD: Cell = { col: 12, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("answers more than one distinct cell over repeated draws", async () => {
  // A held chain and no pellet, so the valid set is nearly the whole interior
  // and nothing on the board moves between one draw and the next.
  poseScene(h, {
    snake: chainFrom(HEAD, "right", 3),
    dir: "right",
    pellet: null,
    travel: false,
  });
  await h.tick();

  const drawn: Cell[] = [];
  for (let draw = 0; draw < DRAWS; draw += 1) {
    const cell = h.debug.drawPelletCell();
    assertNotNull(cell, `a cell answered by draw ${draw + 1}`);
    drawn.push(cell as Cell);
  }
  captureStill(h, "varied");

  const distinct = new Set(drawn.map(({ col, row }) => `${col},${row}`));
  assertGreaterThan(
    distinct.size,
    1,
    `distinct cells across ${DRAWS} draws the game answered`,
  );
});
