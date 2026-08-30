// visibility/obstacle-apart-from-board — an obstacle cell is not the colour of
// the board it sits in.
//
// WHAT THE SPECIFICATION FIXES. `specs/mode.md` states of the course that "an
// obstacle cell is part of the board rather than part of the snake. It is drawn
// one cell in size, distinctly from the wall border, from the snake, and from the
// pellet, so a player reads the course at a glance." The field it is read
// against is `specs/overview.md`'s dark interior. No palette is fixed, so what is
// read is separation alone, against the review item's figure for clearly apart:
// more than 50 of the 441 the RGB cube spans. This suite decides the field half;
// the snake half is `visibility/obstacle-apart-from-snake`.
//
// THE WORLD THIS POSES. ONE obstacle cell, on a cell of the check's choosing,
// rather than the course the mode lays. The requirement is about how an obstacle
// cell is drawn, not about where they are, so the isolated world holds one of
// them and the rest of the interior stays empty — which is also what makes the
// empty cell this samples against unambiguously empty. `specs/instrumentation.md`
// carries `clearObstacles` and `addObstacle` for exactly this, and `poseScene`
// spends them in the order the surface accepts. The pellet is off the board and
// travel is switched off.
//
// A build whose mode lays no obstacle cell carries neither operation, and this
// point belongs only to the mode that does.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  chainFrom,
  colorDistance,
  createHarness,
  HOME_HEAD,
  poseScene,
  sampleCells,
  type Cell,
  type Harness,
} from "../harness";

/** The review item's distance: clearly apart on the 0–441 RGB scale. */
const DISTINCT_MIN = 50;

/** The one obstacle cell this world holds, clear of the posed chain. */
const OBSTACLE_CELL: Cell = { col: 20, row: 5 };

/** The interior cell the posed world leaves empty, far from both and from the wall. */
const BOARD_CELL: Cell = { col: 20, row: 12 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws an obstacle cell apart from an empty interior cell", async () => {
  poseScene(h, {
    obstacles: [OBSTACLE_CELL],
    snake: chainFrom(HOME_HEAD, "right", 3),
    dir: "right",
    pellet: null,
    travel: false,
  });
  await h.advance(1);
  captureStill(h, "scene");

  const [obstacle, board] = sampleCells(h, [OBSTACLE_CELL, BOARD_CELL]);

  assertGreaterThan(
    colorDistance(obstacle, board),
    DISTINCT_MIN,
    "the RGB distance between an obstacle cell's centre and an empty interior cell's",
  );
});
