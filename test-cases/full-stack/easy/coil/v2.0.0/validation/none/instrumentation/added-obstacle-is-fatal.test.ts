// instrumentation/added-obstacle-is-fatal — the head dies on a cell addObstacle
// laid.
//
// specs/instrumentation.md states of the added cell that it is "fatal to the head
// and closed to a pellet spawn from the call onward, exactly as a cell of the
// laid course is". specs/mode.md is what "exactly as" points at: "an obstacle
// cell is fatal to the head, exactly as a wall cell is. Step 3 of the tick ends
// the round when the new head cell is one of them." specs/ui.md names the screen
// a fatal collision reaches: `gameover`.
//
// That the call lays the cell at all is
// `instrumentation/add-obstacle-lays-the-cell`, and that it is closed to a spawn
// is `instrumentation/added-obstacle-closes-a-spawn`.
//
// THE BRACKET runs the chain up to the cell over several ticks and past the
// death, so a reviewer sees the head travelling, the cell it met, and the screen
// the collision opened.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type Cell } from "../constants";
import {
  arrangeStep,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/**
 * Where the head is posed: row 8, the row specs/mode.md keeps clear.
 *
 * To the RIGHT of the starting chain, which a reset lays across columns 13 to 15
 * of that row (specs/board.md). `addObstacle` takes an interior cell "holding no
 * snake segment", and the scene lays its cell before it poses the chain, so the
 * run-up has to leave the chain a reset put there alone.
 */
const HEAD: Cell = { col: 16, row: 8 };

/** Ticks of clear travel before the head reaches the cell. */
const RUN_UP = 3;

/** The one cell the call lays, at the end of that run. */
const OBSTACLE: Cell = { col: HEAD.col + RUN_UP + 1, row: HEAD.row };

/** Ticks run after the death, so the screen it opened is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the round when the head advances into the added cell", async () => {
  const posed = await arrangeStep(h, {
    obstacles: [OBSTACLE],
    head: HEAD,
    dir: "right",
    length: 3,
  });
  assertEqual(posed.snapshot.screen, "playing", "the round before the tick");

  const met = await captureReplay(h, "fatal", async () => {
    const before = await h.tick(RUN_UP);
    const after = await h.tick();
    await h.tick(SETTLE);
    return { before, after };
  });

  assertEqual(met.before.screen, "playing", "the round on the way to the cell");
  assertDeepEqual(
    met.before.snake[0],
    { col: OBSTACLE.col - 1, row: OBSTACLE.row },
    "the head's cell the tick before the collision",
  );
  assertEqual(
    met.after.screen,
    "gameover",
    "the screen the added cell reached",
  );
});
