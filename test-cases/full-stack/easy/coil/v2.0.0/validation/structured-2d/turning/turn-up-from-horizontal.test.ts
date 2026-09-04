// turning/turn-up-from-horizontal — travelling right, a up request turns the
// snake up on the next tick.
//
// specs/movement.md: step 1 "takes the oldest buffered request and applies it only
// when it is perpendicular to the direction the snake is travelling in on this
// tick. While travelling horizontally only `up` and `down` are perpendicular;
// while travelling vertically only `left` and `right` are." This is one of those
// four turns, and it has a point of its own because a build that steers three ways
// and drops the fourth has to grade differently from one that steers none.
//
// The reading is the pair the rule fixes: `dir` after the tick, and the cell the
// head advanced into, which is one cell above where it stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../../src/constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/**
 * Where the chain is posed: clear board above it, and behind it for the chain to trail into.
 */
const HEAD: Cell = { col: 10, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns up from a rightward run, on the tick after the request", async () => {
  const posed = arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  assertEqual(posed.snapshot.dir, "right", "the posed direction");

  const turned = await captureReplay(h, "up", async () => {
    await h.tap(BINDINGS.up[0]);
    return h.tick();
  });

  assertEqual(turned.dir, "up", "dir after the tick");
  assertDeepEqual(
    turned.snake[0],
    ahead(HEAD, "up"),
    "the head after the tick",
  );
});
