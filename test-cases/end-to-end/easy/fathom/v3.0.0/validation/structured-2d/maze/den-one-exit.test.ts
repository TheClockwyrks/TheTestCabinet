// maze/den-one-exit — the den has exactly one gate.
//
// specs/maze.md, under "The den": the chamber "has exactly one gate tile, on
// its top edge", and "The gate is the predators' door, crossed leaving the den
// and crossed again returning to it."
//
// TWO READINGS, BECAUSE THE RULE HAS TWO HALVES. How many `g` tiles the layout
// carries, which must be one; and where that one sits, which must be the top of
// the chamber.
//
// WHAT "ON ITS TOP EDGE" IS READ AS. The specification makes the chamber den
// interior throughout, over "columns `16` through `19` and rows `7` through `9`",
// and puts the one gate in row `6` directly above it. So the gate is never a
// chamber tile, and what separates that gate from a side or a bottom one is the
// pair of readings below. WHERE the chamber itself sits is `maze/den-bounds`, so
// this point asks only about the door:
//
//   * the tile directly BELOW the gate is den interior, so the door opens onto
//     the chamber from above rather than from a flank; and
//   * no den-interior tile lies in a row ABOVE the gate, so there is no part of
//     the chamber the gate is not on the top of.
//
// A gate beside the chamber fails the first (the tile below it is rock), a gate
// under the chamber fails it too, and a gate buried in the middle of the chamber
// fails the second.
//
// THE STILL IS FRAMED ON THE DEN, for the reason `maze/den-enclosed` gives: a
// picture of the trench taken anywhere else shows a reviewer nothing about the
// chamber's doors.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly seeded layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { denTiles, gateTiles, tileAt } from "../maze";
import {
  captureBoard,
  freshBoards,
  requireDenChamber,
  requireLaidOut,
  witness,
} from "./boards";

/**
 * How many den-gate tiles a conforming layout carries.
 *
 * Exactly one: specs/maze.md gives the chamber "exactly one gate tile".
 */
const GATES = 1;

/**
 * How many den-interior tiles may lie above the gate's row.
 *
 * None: a gate "on its top edge" has the whole chamber below it.
 */
const MAX_ABOVE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the den exactly one gate, on the top edge of its chamber", async () => {
  const boards = freshBoards(h);
  requireLaidOut(boards);
  requireDenChamber(boards);

  const measured = boards.map((board) => {
    const gates = gateTiles(board.snapshot);
    const gate = gates[0];
    const alone = gates.length === GATES;
    const below = alone ? tileAt(board.snapshot, gate.tx, gate.ty + 1) : null;
    const above = alone
      ? denTiles(board.snapshot).filter((tile) => tile.ty < gate.ty)
      : [];
    return {
      board,
      gates,
      below,
      above,
      ok: alone && below === "d" && above.length === MAX_ABOVE,
    };
  });
  await captureBoard(h, witness(measured).board, "den");

  for (const one of measured) {
    const seed = `the maze laid out from seed ${one.board.seed}`;
    const where =
      one.gates.map((tile) => `(${tile.tx}, ${tile.ty})`).join(", ") ||
      "nowhere";
    assertEqual(
      one.gates.length,
      GATES,
      `den-gate ('g') tiles in ${seed}, at ${where}`,
    );
    // Reached only when the assertion above found exactly one gate.
    const gate = one.gates[0];
    assertEqual(
      one.below,
      "d",
      `the tile directly below the gate at (${gate.tx}, ${gate.ty}) in ${seed}, ` +
        `which a gate on the chamber's top edge opens onto`,
    );
    assertEqual(
      one.above.length,
      MAX_ABOVE,
      `den-interior tiles above the gate's row ${gate.ty} in ${seed}, which a ` +
        `gate on the chamber's top edge leaves none of`,
    );
  }
});
