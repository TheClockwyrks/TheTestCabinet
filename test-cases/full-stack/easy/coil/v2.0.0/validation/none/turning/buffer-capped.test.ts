// turning/buffer-capped — the buffer holds at most `TURN_QUEUE_MAX` requests.
//
// specs/movement.md: "The buffer holds at most `TURN_QUEUE_MAX` (`2`) requests,
// and a request arriving at a full buffer is discarded."
// specs/instrumentation.md says the same from the snapshot's side: `turns`
// "holds at most `TURN_QUEUE_MAX` of them".
//
// TWO READINGS, BECAUSE DISCARDED HAS TO MEAN DISCARDED. The first is the buffer
// itself the moment the third request has been made: two entries, and they are
// the two oldest. The second is that the third request never turns the snake
// afterwards either — a build that queued it into a third place, or that dropped
// the OLDEST to make room, both come out with a different heading on one of the
// three ticks driven here.
//
// The three requests are three distinct directions, so no reading rests on a
// request that step 1 would have refused for some other reason: `down` and `left`
// each become perpendicular in turn, and `up` would too if the buffer had kept
// it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { KEY, TURN_QUEUE_MAX, type Cell } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Where the chain is posed: clear board below it and to its left. */
const HEAD: Cell = { col: 10, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards a third request, and never turns the snake by it", async () => {
  await arrangeStep(h, { head: HEAD, dir: "right", length: 3 });

  const run = await captureReplay(h, "full", async () => {
    await h.tap(KEY.down);
    await h.tap(KEY.left);
    await h.tap(KEY.up);
    const buffered = await h.snapshot();
    const first = await h.tick();
    const second = await h.tick();
    const third = await h.tick();
    return { buffered, first, second, third };
  });

  assertLength(
    run.buffered.turns,
    TURN_QUEUE_MAX,
    "the buffer with three made",
  );
  assertDeepEqual(
    run.buffered.turns,
    ["down", "left"],
    "the two oldest requests, in order",
  );

  const down = ahead(HEAD, "down");
  const left = ahead(down, "left");
  assertEqual(run.first.dir, "down", "dir after the first tick");
  assertDeepEqual(run.first.snake[0], down, "the head after the first tick");
  assertEqual(run.second.dir, "left", "dir after the second tick");
  assertDeepEqual(run.second.snake[0], left, "the head after the second tick");

  // The third request was discarded rather than held back, so the tick after the
  // buffer emptied carries the snake straight on.
  assertEqual(run.third.dir, "left", "dir after the discarded request's turn");
  assertDeepEqual(
    run.third.snake[0],
    ahead(left, "left"),
    "the head once the buffer had emptied",
  );
  assertDeepEqual(run.third.turns, [], "turns once every request had resolved");
});
