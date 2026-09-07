// maze/den-bounds — the den chamber is where the specification puts it.
//
// `specs/maze.md`, under "The den": "The chamber is made of den-interior tiles and
// covers columns `16` through `19` and rows `7` through `9`, all four bounds
// inclusive, so it is `4` tiles wide and `3` tiles tall."
//
// WHAT THE FIGURE BUYS A PLAYER. The den is the one fixed landmark in a maze laid
// out afresh each dive, and the release schedule, the gate and the routes around
// the chamber all read off it. A build that put the chamber somewhere else, or
// made it a different size, moves the one part of the board a player can count on
// between dives.
//
// THE READING IS THE SET OF DEN-INTERIOR TILES, held against the rectangle those
// four bounds name. Both directions are asserted: every den-interior tile lies
// inside the rectangle, and every tile of the rectangle is den interior. A chamber
// shifted a column over fails the first; a chamber with a hole in it, or one three
// tiles wide, fails the second.
//
// WHAT THIS IS NOT. It is not the gate: `maze/den-one-exit` counts it and places
// it. It is not the wall around the chamber: `maze/den-enclosed`. And it is not
// whether the chamber leads anywhere: `maze/den-reachable`.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly laid-out layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import {
  DEN_COL_MAX,
  DEN_COL_MIN,
  DEN_ROW_MAX,
  DEN_ROW_MIN,
} from "../constants";
import { createHarness, type Harness } from "../harness";
import { denTiles, isDen, tileKey } from "../maze";
import {
  captureBoard,
  freshBoards,
  assertDenChamber,
  assertLaidOut,
  witness,
} from "./boards";

/** How many tiles the rectangle those four bounds name holds. */
const CHAMBER_TILES =
  (DEN_COL_MAX - DEN_COL_MIN + 1) * (DEN_ROW_MAX - DEN_ROW_MIN + 1);

/** How many offending tiles a failure names before it trails off. */
const NAMED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("makes the den chamber the four-by-three block at columns 16 to 19, rows 7 to 9", async () => {
  const boards = await freshBoards(h);
  assertLaidOut(boards);
  assertDenChamber(boards);

  const measured = boards.map((board) => {
    const outside = denTiles(board.snapshot).filter(
      (tile) =>
        tile.tx < DEN_COL_MIN ||
        tile.tx > DEN_COL_MAX ||
        tile.ty < DEN_ROW_MIN ||
        tile.ty > DEN_ROW_MAX,
    );
    const missing: string[] = [];
    for (let ty = DEN_ROW_MIN; ty <= DEN_ROW_MAX; ty += 1) {
      for (let tx = DEN_COL_MIN; tx <= DEN_COL_MAX; tx += 1) {
        if (!isDen(board.snapshot, tx, ty)) missing.push(tileKey({ tx, ty }));
      }
    }
    return {
      board,
      outside,
      missing,
      ok: outside.length === 0 && missing.length === 0,
    };
  });
  await captureBoard(h, witness(measured).board, "den");

  for (const one of measured) {
    const strays = one.outside
      .slice(0, NAMED)
      .map((tile) => tileKey(tile))
      .join(", ");
    assertEqual(
      one.outside.length,
      0,
      `den-interior tiles outside columns ${String(DEN_COL_MIN)} to ` +
        `${String(DEN_COL_MAX)} and rows ${String(DEN_ROW_MIN)} to ` +
        `${String(DEN_ROW_MAX)} in the maze laid out as board ` +
        `${one.board.ordinal}` +
        (strays === "" ? "" : `, at ${strays}`) +
        " (specs/maze.md)",
    );
    assertEqual(
      one.missing.length,
      0,
      `tiles of the ${String(CHAMBER_TILES)}-tile chamber the specification ` +
        `names that maze ${one.board.ordinal} the game laid out does not ` +
        "mark as den interior" +
        (one.missing.length === 0
          ? ""
          : `, at ${one.missing.slice(0, NAMED).join(", ")}`) +
        " (specs/maze.md)",
    );
  }
});
