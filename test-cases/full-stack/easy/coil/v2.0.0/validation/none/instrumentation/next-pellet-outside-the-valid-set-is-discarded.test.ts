// instrumentation/next-pellet-outside-the-valid-set-is-discarded — a posed cell
// the board no longer allows is dropped at the spawn, not forced onto the board.
//
// specs/instrumentation.md: "A posed cell outside the valid set at that moment is
// discarded and the spawn draws at random", and "Whether the cell is valid is
// decided at the spawn rather than at the call, so a posed cell may hold a snake
// segment or an obstacle when it is posed". This is the rule the points about the
// valid set lean on: they pose a cell the valid set must exclude and read that the
// build put the pellet somewhere else. A build that honored the pose regardless
// would pass every one of them by placing a pellet where specs/board.md says none
// can be.
//
// THE POSED CELL IS A BODY CELL that stays occupied through the eat. The tail
// cell would not do, because the chain grows on the tick that eats and the tail
// stays put either way; a cell in the middle of the chain is occupied on every
// tick whatever the eat does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import type { Cell } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  holdsCell,
  isInterior,
  type Harness,
} from "../harness";

/** Cells of the posed chain. */
const LENGTH = 5;

/** Ticks run after the eat, with the chain held, so the board is seen settled. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the pellet elsewhere when the posed cell holds the chain", async () => {
  const scene = await arrangeEat(h, { pelletRespawn: true, length: LENGTH });
  // The middle of the chain, occupied before and after the eat.
  const body: Cell = scene.snapshot.snake[2];
  await h.debug.setNextPellet(body.col, body.row);
  const posed = await h.snapshot();
  assertEqual(
    holdsCell(posed.snake, body),
    true,
    "the posed cell held by the chain at the pose",
  );

  const after = await captureReplay(h, "discarded", async () => {
    const eaten = await h.tick();
    await h.debug.setSnakeTravel(false);
    await h.tick(SETTLE);
    return eaten;
  });

  assertEqual(
    holdsCell(after.snake, body),
    true,
    "the posed cell still held by the chain at the spawn",
  );
  assertNotNull(after.pellet, "a pellet placed by the eat");
  const pellet = after.pellet as Cell;
  assertEqual(
    holdsCell(after.snake, pellet),
    false,
    `the placed pellet at (${pellet.col}, ${pellet.row}), clear of the chain`,
  );
  assertEqual(
    isInterior(pellet.col, pellet.row),
    true,
    "the placed pellet on an interior cell",
  );
  assertNull(
    after.nextPellet,
    "nextPellet once the discarded pose is consumed",
  );
});
