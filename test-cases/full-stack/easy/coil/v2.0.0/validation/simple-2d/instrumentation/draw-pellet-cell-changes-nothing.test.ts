// instrumentation/draw-pellet-cell-changes-nothing — the draw alone leaves the
// game as it stands.
//
// specs/instrumentation.md: `drawPelletCell` "is the draw and nothing else, so
// it places nothing and changes nothing: the live pellet, the chain, every
// figure, and a cell `setNextPellet` posed are left as they stand. The pose is
// neither taken nor consumed". What is read is the whole snapshot before and
// after one call, on a board carrying each of the things the reading is said to
// leave alone: a chain, a live pellet, a score, and a posed next cell.
//
// A build whose reading placed the drawn cell, ran a spawn, or consumed the pose
// on the way would hand every check that reads the draw a changed world, so the
// reading's honesty is a point of its own rather than a hazard of the points
// that use it. That the reading answers a cell of the valid set at all is read
// by `instrumentation/debug-api`; that the draw MOVES is `growth/respawn-varies`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import type { Cell } from "../constants";
import {
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The head of the chain the board holds. */
const HEAD: Cell = { col: 12, row: 6 };

/** The live pellet, away from the chain. */
const PELLET: Cell = { col: 20, row: 6 };

/** The cell posed for the next spawn, free at the call. */
const POSED: Cell = { col: 24, row: 13 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every field of the snapshot as it stood", async () => {
  poseScene(h, {
    snake: chainFrom(HEAD, "down", 4),
    dir: "down",
    pellet: PELLET,
    nextPellet: POSED,
    score: 70,
    travel: false,
  });
  const before = await h.tick();
  assertDeepEqual(
    before.nextPellet,
    POSED,
    "the pose standing before the draw",
  );

  const cell = h.debug.drawPelletCell();
  assertNotNull(cell, "a cell answered on a board with free cells");
  const after = h.snapshot();
  captureStill(h, "standing");

  assertDeepEqual(after, before, "the snapshot after the draw");
});
