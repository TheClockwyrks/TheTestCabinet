// maze/start-tile-in-range — the start tile sits in the lower half.
//
// specs/maze.md, under "A conforming maze": "The forager's start tile. It is a
// corridor tile, and its row lies between `START_TILE_ROW_MIN` (`9`) and
// `START_TILE_ROW_MAX` (`16`) inclusive."
//
// WHAT A START TILE UP AMONG THE DEN'S OWN ROWS COSTS is a dive that opens inside
// the hunters' reach every time, which is why the rule is a rule.
//
// IT IS MEASURED ON EVERY SEED, because it is cheap: a fresh layout is a `reset`
// and a read, and several boards is what specs/maze.md's "every maze the game
// lays out" asks of a generator.
//
// THAT A LOST LIFE PUTS THE FORAGER BACK ON THIS TILE is `maze.start-tile-respawn`,
// a separate rule from a separate file (specs/progression.md) that a build can
// break on its own.

import { afterEach, beforeEach, it } from "vitest";

import { assertBetween, assertEqual } from "../assert";
import { START_TILE_ROW_MAX, START_TILE_ROW_MIN } from "../constants";
import { createHarness, type Harness } from "../harness";
import { isCorridor } from "../maze";
import { captureBoard, freshBoards, requireLaidOut, witness } from "./boards";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens every maze on a corridor tile in rows 9 to 16", async () => {
  const boards = await freshBoards(h);
  requireLaidOut(boards);

  const measured = boards.map((board) => {
    const { tx, ty } = board.snapshot.forager;
    const inRange =
      ty >= START_TILE_ROW_MIN &&
      ty <= START_TILE_ROW_MAX &&
      isCorridor(board.snapshot, tx, ty);
    return { board, tx, ty, ok: inRange };
  });
  await captureBoard(h, witness(measured).board, "board", "start");

  for (const one of measured) {
    assertEqual(
      isCorridor(one.board.snapshot, one.tx, one.ty),
      true,
      `the start tile (${one.tx}, ${one.ty}) of the maze laid out from seed ` +
        `${one.board.seed} is an open corridor tile (specs/maze.md)`,
    );
    assertBetween(
      one.ty,
      START_TILE_ROW_MIN,
      START_TILE_ROW_MAX,
      `the row of the start tile of the maze laid out from seed ` +
        `${one.board.seed} (specs/maze.md)`,
    );
  }
});
