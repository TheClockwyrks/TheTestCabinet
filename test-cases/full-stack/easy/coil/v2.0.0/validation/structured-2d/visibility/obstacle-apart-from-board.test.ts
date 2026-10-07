// visibility/obstacle-apart-from-board — an obstacle is drawn on the cell it
// occupies.
//
// WHAT THE SPECIFICATION FIXES. `specs/mode.md` states of the course that "an
// obstacle cell is part of the board rather than part of the snake. It is drawn
// one cell in size", over `specs/overview.md`'s interior. The palette is the
// build's and how an obstacle looks is the presentation domain's aesthetic
// rating, so the one thing a check may read off the picture is PRESENCE: whether
// the build painted the cell an obstacle sits on at all.
//
// HOW PRESENCE IS READ. The same point, twice. One obstacle cell is laid on a
// cell of the check's choosing and its centre is sampled; the course is then
// taken off the board with `clearObstacles` (`specs/instrumentation.md`) and the
// same point is sampled again. A build that drew the obstacle renders two
// different pixels; a build that left the cell as the empty field renders one.
//
// THE WORLD THIS POSES. ONE obstacle cell rather than the course the mode lays.
// The requirement is about how an obstacle cell is drawn, not about where they
// are, so the isolated world holds one of them and the rest of the interior stays
// empty. The pellet is off the board and travel is switched off, so nothing moves
// between the two readings.
//
// A build whose mode lays no obstacle cell carries neither operation, and this
// point belongs only to the mode that does.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual } from "../assert";
import {
  captureStill,
  chainFrom,
  clearObstacles,
  createHarness,
  HOME_HEAD,
  poseScene,
  sampleCells,
  type Cell,
  type Harness,
  type Rgb,
} from "../harness";

/** The one obstacle cell this world holds, clear of the posed chain. */
const OBSTACLE_CELL: Cell = { col: 20, row: 5 };

/** A sampled colour as one string, so a failure names the reading plainly. */
function shows(color: Rgb): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints an obstacle's cell, and leaves it unpainted once the course is gone", async () => {
  poseScene(h, {
    obstacles: [OBSTACLE_CELL],
    snake: chainFrom(HOME_HEAD, "right", 3),
    dir: "right",
    pellet: null,
    travel: false,
  });
  await h.advance(1);
  captureStill(h, "scene");

  const [withObstacle] = sampleCells(h, [OBSTACLE_CELL]);

  clearObstacles(h);
  await h.advance(1);
  const [withoutObstacle] = sampleCells(h, [OBSTACLE_CELL]);

  assertNotEqual(
    shows(withObstacle),
    shows(withoutObstacle),
    "an obstacle cell's centre with the obstacle on the board, against the same point with the course cleared",
  );
});
