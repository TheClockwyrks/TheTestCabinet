// states/round-lays-out-the-board — a round opens on the board specs/board.md
// lays out.
//
// specs/board.md: a round starts the snake at `START_LENGTH` cells, laid
// horizontally near the centre facing `right`, at exactly the three cells that
// file tables; "The first pellet of a round is placed after the snake is laid at
// its starting cells, so it never lands under the starting chain", and a valid
// pellet cell is an interior cell holding no snake segment and no obstacle.
// specs/scoring.md opens the round at a score of `0` with `M` at `1`, and the
// first pellet of a round meets a CLOSED window, so the window opens empty.
//
// The round is opened from the title with `confirm`, because that is the one
// thing that lays a round out: specs/instrumentation.md makes `setScreen`
// deliberately run the tick over the board as it stands instead.

import { afterEach, beforeEach, it } from "vitest";
import {
  BINDINGS,
  INTERIOR_COL_MAX,
  INTERIOR_ROW_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MIN,
  START_CELLS,
  START_DIR,
} from "../constants";
import {
  assertBetween,
  assertDeepEqual,
  assertEqual,
  assertTrue,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdsCell,
  openTitle,
  type Harness,
} from "../harness";

/** The first key `specs/controls.md` binds to `confirm`. */
const CONFIRM = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the round on the starting chain with one valid pellet", async () => {
  openTitle(h);
  await h.tap(CONFIRM);
  captureStill(h, "laid");

  const round = h.snapshot();
  assertEqual(round.screen, "playing", "the screen the round opened on");
  assertDeepEqual(
    round.snake,
    [...START_CELLS],
    "the chain a round opens with",
  );
  assertEqual(round.dir, START_DIR, "the direction the chain opens facing");
  assertEqual(round.score, 0, "the score a round opens at");
  assertEqual(round.combo, 1, "the multiplier a round opens at");
  assertEqual(round.comboWindow, 0, "the combo window a round opens with");

  const { pellet } = round;
  if (pellet === null) {
    fail("one live pellet on the board a round opens", pellet);
  }
  assertBetween(
    pellet.col,
    INTERIOR_COL_MIN,
    INTERIOR_COL_MAX,
    "the pellet's column",
  );
  assertBetween(
    pellet.row,
    INTERIOR_ROW_MIN,
    INTERIOR_ROW_MAX,
    "the pellet's row",
  );
  assertTrue(
    !holdsCell(round.snake, pellet),
    "a pellet clear of the starting chain",
  );
  assertTrue(
    !holdsCell(round.obstacles, pellet),
    "a pellet clear of the obstacle course",
  );
});
