// visibility/obstacle-apart-from-snake — an obstacle cell is never mistaken for
// a segment of the snake threading past it.
//
// WHAT THE SPECIFICATION FIXES. `specs/mode.md` requires an obstacle cell drawn
// "distinctly from the wall border, from the snake, and from the pellet, so a
// player reads the course at a glance". The palette is the build's, so what is
// read is separation alone, against the review item's figure for clearly apart:
// more than 50 of the 441 the RGB cube spans. This suite decides the snake half
// of that requirement, and takes both pieces of the snake a player has to tell
// an obstacle from: the head, drawn its own way, and a body cell, drawn another.
//
// THE WORLD THIS POSES. One obstacle cell of the check's choosing rather than
// the course the mode lays, because the requirement is about how an obstacle is
// drawn rather than about where the course runs, and the chain beside it. The
// pellet is off the board and travel is switched off, so nothing moves between
// the pose and the sample and nothing else is painted near either cell.

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

/** Head, a straight body cell, another, and the tail. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws an obstacle cell apart from the head and from a body cell", async () => {
  const chain = chainFrom(HOME_HEAD, "right", LENGTH);
  poseScene(h, {
    obstacles: [OBSTACLE_CELL],
    snake: chain,
    dir: "right",
    pellet: null,
    travel: false,
  });
  await h.advance(1);
  captureStill(h, "scene");

  const [obstacle, head, body] = sampleCells(h, [
    OBSTACLE_CELL,
    chain[0],
    chain[1],
  ]);

  assertGreaterThan(
    colorDistance(obstacle, head),
    DISTINCT_MIN,
    "the RGB distance between an obstacle cell's centre and the head cell's",
  );
  assertGreaterThan(
    colorDistance(obstacle, body),
    DISTINCT_MIN,
    "the RGB distance between an obstacle cell's centre and a body cell's",
  );
});
