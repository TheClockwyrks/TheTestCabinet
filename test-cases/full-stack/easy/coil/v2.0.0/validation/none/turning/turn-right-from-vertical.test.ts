// turning/turn-right-from-vertical — travelling up, a right request turns the
// snake right on the next tick.
//
// specs/movement.md: step 1 "takes the oldest buffered request and applies it only
// when it is perpendicular to the direction the snake is travelling in on this
// tick. While travelling horizontally only `up` and `down` are perpendicular;
// while travelling vertically only `left` and `right` are." This is one of those
// four turns, and it has a point of its own because a build that steers three ways
// and drops the fourth has to grade differently from one that steers none.
//
// The reading is the pair the rule fixes: `dir` after the tick, and the cell the
// head advanced into, which is one cell right of where it stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { KEY, type Cell } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/**
 * Where the chain is posed: clear board to its right, and below it for
 * the chain to trail into.
 */
const HEAD: Cell = { col: 10, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns right from an upward run, on the tick after the request", async () => {
  const posed = await arrangeStep(h, { head: HEAD, dir: "up", length: 3 });
  assertEqual(posed.snapshot.dir, "up", "the posed direction");

  const turned = await captureReplay(h, "right", async () => {
    await h.tap(KEY.right);
    return h.tick();
  });

  assertEqual(turned.dir, "right", "dir after the tick");
  assertDeepEqual(turned.snake[0], ahead(HEAD, "right"), "the head after the tick");
});
