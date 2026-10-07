// instrumentation/add-obstacle-lays-the-cell — one call lays one obstacle cell.
//
// specs/instrumentation.md words `addObstacle` as adding "one obstacle cell at
// `(col, row)`". This point is that sentence and nothing else: the board holds
// exactly the cell the call named, and no other. That the cell is FATAL is
// `instrumentation/added-obstacle-is-fatal`, and that it is closed to a spawn is
// `instrumentation/added-obstacle-closes-a-spawn` — three points, because a build
// that lays the cell in its list and leaves the head walking through it passes
// this one and fails that one.
//
// WHY THE COURSE IS CLEARED FIRST. The claim is about ONE cell — the one the call
// named — so the board this poses holds exactly that one and nothing else, and
// the list read afterwards can say so outright rather than say the list grew by
// one. That also keeps this point clear of `board/obstacles-layout`, where the
// laid course is decided.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { type Cell } from "../constants";
import {
  arrangeStep,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** Where the head is posed. Row 8 is the row specs/mode.md keeps clear. */
const HEAD: Cell = { col: 10, row: 8 };

/** The one cell the call lays: directly ahead of the head. */
const OBSTACLE: Cell = { col: 11, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds exactly the cell the call named and no other", async () => {
  const posed = arrangeStep(h, {
    obstacles: [OBSTACLE],
    head: HEAD,
    dir: "right",
    length: 3,
    travel: false,
  });
  captureStill(h, "added");

  assertLength(
    posed.snapshot.obstacles,
    1,
    "the obstacle cells on the board after one addObstacle over a cleared course",
  );
  assertDeepEqual(
    posed.snapshot.obstacles[0],
    OBSTACLE,
    "the cell the call laid",
  );
});
