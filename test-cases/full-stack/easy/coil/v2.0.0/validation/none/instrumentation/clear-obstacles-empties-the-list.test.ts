// instrumentation/clear-obstacles-empties-the-list — one call takes the whole
// course off the board.
//
// specs/instrumentation.md words `clearObstacles` as taking "every obstacle cell
// off the board at once, leaving `obstacles` empty". That is this point, and it
// is the reported list alone: whether the cells the call took off have BECOME
// ordinary interior cells is `instrumentation/cleared-cell-is-safe` and
// `instrumentation/cleared-cell-takes-a-pellet`, because a build that empties the
// list without opening the cells passes this one and fails those.
//
// The course is read back before the call, so a mode that laid nothing cannot
// pass by having had nothing to clear.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength, fail } from "../assert";
import {
  captureStill,
  createHarness,
  obstacleSurface,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves obstacles empty after one call", async () => {
  const laid = await poseScene(h, {
    obstacles: "course",
    pellet: null,
    travel: false,
  });
  assertGreaterThan(
    laid.obstacles.length,
    0,
    "obstacle cells on the board before the call",
  );

  const surface = await obstacleSurface(h);
  if (surface === null) {
    return fail(
      "a build whose mode lays obstacle cells to carry clearObstacles",
      "the surface carries no obstacle operations",
    );
  }
  await surface.clearObstacles();
  await h.advance(1);
  await captureStill(h, "cleared");

  assertLength(
    (await h.snapshot()).obstacles,
    0,
    "the obstacle cells left on the board",
  );
});
