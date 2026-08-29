// maze/den-enclosed — the den chamber is enclosed.
//
// specs/maze.md, under "The den": "It is enclosed. No den-interior tile has a
// corridor neighbor, so the gate is the chamber's only opening onto the
// corridors."
//
// The reading walks every den-interior tile of the layout and looks at its four
// neighbors, counting the ones that are corridor. The bound is zero. A chamber
// tile that touches corridor directly is a second doorway, and the predators'
// staggered release through one gate — which the whole den exists for — has a way
// around it.
//
// WHAT THIS IS NOT. It is not the gate count: that is `maze/den-one-exit`'s. And
// it is not whether the gate connects to anything: a chamber sealed on all four
// sides passes this point and fails `maze/den-reachable`. The three are the three
// halves of "one door, in the right place, that leads somewhere", and a build
// that breaks one of them should fail one of them.
//
// THE STILL IS FRAMED ON THE DEN. The verdict comes off `snapshot().tiles` and
// does not depend on the picture, but a screenshot taken wherever the forager
// spawned shows a reviewer none of the wall this point is about — the trench is
// dark and only what the light reaches is drawn at all. So the forager is stood
// on the corridor outside the gate with its brightness turned up, which puts the
// chamber and its one doorway in frame.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly seeded layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { denCorridorBreaches } from "../maze";
import { check } from "../scene";
import {
  captureBoard,
  freshBoards,
  requireDenChamber,
  requireLaidOut,
  witness,
} from "./boards";

/**
 * How many den-interior tiles may touch corridor directly.
 *
 * None: specs/maze.md says "No den-interior tile has a corridor neighbor".
 */
const MAX_BREACHES = 0;

/** How many offending tiles a failure names before it trails off. */
const NAMED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "encloses the den chamber, leaving the gate its only opening onto the corridors",
  async () => {
    const boards = await freshBoards(h);
    requireLaidOut(boards);
    requireDenChamber(boards);

    const measured = boards.map((board) => {
      const breaches = denCorridorBreaches(board.snapshot);
      return { board, breaches, ok: breaches.length === MAX_BREACHES };
    });
    await captureBoard(h, witness(measured).board, "den");

    for (const one of measured) {
      const named = one.breaches
        .slice(0, NAMED)
        .map((tile) => `(${tile.tx}, ${tile.ty})`)
        .join(", ");
      assertEqual(
        one.breaches.length,
        MAX_BREACHES,
        `den-interior tiles with a corridor neighbor in the maze laid out from ` +
          `seed ${one.board.seed}` +
          (named === "" ? "" : `, at ${named}`),
      );
    }
  },
);
