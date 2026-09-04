// turning/reversal-discarded — a request naming the opposite of the current
// heading is discarded at step 1.
//
// specs/movement.md: "A request that repeats the current direction and a request
// that reverses it are both discarded at step 1, and the snake keeps its
// direction. The snake therefore never reverses into its own neck."
//
// WHY THE CHAIN MATTERS HERE. The posed chain trails directly behind the head, so
// the cell a reversal would send the head into is the neck: a build that applies
// the reversal does not merely turn, it drives the head into its own second
// segment on that same tick and ends the round. Both outcomes are caught by the
// same readings, because a heading of `right`, a head one cell further right, and
// a round still running are the only things the rule permits.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/** Where the chain is posed: a clear run to its right, and its neck to its left. */
const HEAD: Cell = { col: 10, row: 8 };

/** Ticks of clear travel before the request, so the run is on the recording. */
const RUN_UP = 3;

/** Ticks run after the tick that resolves it, so its outcome is too. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the heading when the request reverses it", async () => {
  const posed = arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  assertDeepEqual(
    posed.snapshot.snake[1],
    ahead(HEAD, "left"),
    "the neck a reversal would enter",
  );

  const run = await captureReplay(h, "reversal", async () => {
    const before = await h.tick(RUN_UP);
    await h.tap(BINDINGS.left[0]);
    const stepped = await h.tick();
    await h.tick(SETTLE);
    return { before, stepped };
  });
  const { before, stepped: after } = run;

  assertEqual(after.dir, "right", "dir after a reversing request");
  assertDeepEqual(
    after.snake[0],
    ahead(before.snake[0], "right"),
    "the head after a reversing request",
  );
  assertEqual(after.screen, "playing", "the round after a reversing request");
});
