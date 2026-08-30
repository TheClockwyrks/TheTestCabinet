// growth/respawn-off-snake — no pellet the game places lands on the snake.
//
// specs/board.md's valid set: "It holds no snake segment." A pellet under the
// chain is one the player cannot eat and, worse, one they cannot see, so the
// round stalls with nothing on the board to go for.
//
// AGAINST A DELIBERATELY LONG CHAIN, because that is where the rule starts to
// matter. A three-cell snake on a 448-cell board is missed by chance by almost
// any draw; a chain of sixty that grows to ninety over the run covers a fifth of
// the board, and a build that draws a cell without testing it against the chain
// hits one before long. Every placement is read against the chain AS IT STOOD
// when that pellet was placed, which is the chain the rule is worded against.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdsCell,
  type Harness,
} from "../harness";
import { driveEats } from "./eats";

/** Cells the chain is posed at, before the run lengthens it by one an eat. */
const START = 60;

/** Draws taken from the generator over the run. */
const EATS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never places a pellet on a cell the chain holds", async () => {
  const run = await captureReplay(h, "clear", () =>
    driveEats(h, { start: START, eats: EATS }),
  );

  for (const [index, placed] of run.placements.entries()) {
    assertEqual(
      holdsCell(placed.snake, placed.pellet),
      false,
      `pellet ${index + 1} of ${EATS} against a chain of ${placed.snake.length}`,
    );
  }
});
