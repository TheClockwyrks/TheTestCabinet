// turning/same-direction-discarded — a request naming the heading the snake
// already travels in is discarded at step 1.
//
// specs/movement.md: "A request that repeats the current direction and a request
// that reverses it are both discarded at step 1, and the snake keeps its
// direction." Discarded rather than applied harmlessly, which is why the buffer
// is read as well as the heading: a build that leaves a repeat sitting on the
// buffer has spent one of the two places `TURN_QUEUE_MAX` allows, and the next
// real turn the player asks for is the one that gets thrown away.
//
// So three readings, all of one rule: the heading is unchanged, the head advanced
// the way it was already going, and the request is gone from `turns`.

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

/** Where the chain is posed: a clear run to its right. */
const HEAD: Cell = { col: 10, row: 8 };

/** Ticks of clear travel before the request, so the run is on the recording. */
const RUN_UP = 3;

/** Ticks run after the tick that resolves it, so its outcome is too. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the heading and empties the buffer on a repeated request", async () => {
  await arrangeStep(h, { head: HEAD, dir: "right", length: 3 });

  const run = await captureReplay(h, "repeat", async () => {
    const before = await h.tick(RUN_UP);
    await h.tap(KEY.right);
    const stepped = await h.tick();
    await h.tick(SETTLE);
    return { before, stepped };
  });
  const { before, stepped: after } = run;

  assertEqual(after.dir, "right", "dir after a repeated request");
  assertDeepEqual(
    after.snake[0],
    ahead(before.snake[0], "right"),
    "the head after a repeated request",
  );
  assertDeepEqual(after.turns, [], "turns after step 1 discarded the request");
});
