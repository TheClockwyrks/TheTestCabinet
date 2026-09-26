// turning/applied-next-tick — a steering request moves nothing where it is made.
//
// specs/movement.md: "A steering request is buffered rather than applied where it
// is made, and step 1 of the next tick applies it." So the request has two
// observable moments and this point reads both: at the call the chain and `dir`
// are exactly as they were and the request is sitting on the buffer, and on the
// next tick `dir` is the new one and the head advanced that way.
//
// A build that steers the snake the instant a key is read plays quite differently
// from one that buffers: the turn lands part way through a tick, on a fraction of
// a cell, and the snake stops being a thing that moves cell by cell. That is the
// build this point is here to catch.

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

/** Where the chain is posed: clear board above it and to its right. */
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

it("buffers the request, and applies it on the next tick", async () => {
  const posed = await arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  assertEqual(posed.snapshot.dir, "right", "the posed direction");

  const turn = await captureReplay(h, "turn", async () => {
    const before = await h.tick(RUN_UP);
    await h.tap(KEY.up);
    const requested = await h.snapshot();
    const turned = await h.tick();
    await h.tick(SETTLE);
    return { before, requested, turned };
  });

  // At the call: nothing moved, the heading is the old one, and the request is
  // waiting on the buffer.
  assertEqual(turn.requested.ticks, RUN_UP, "ticks at the request");
  assertEqual(turn.requested.dir, "right", "dir at the request");
  assertDeepEqual(
    turn.requested.snake,
    turn.before.snake,
    "the chain at the request",
  );
  assertDeepEqual(turn.requested.turns, ["up"], "the buffered request");

  // On the next tick: step 1 applied it, and the head advanced the new way.
  assertEqual(turn.turned.dir, "up", "dir after the tick");
  assertDeepEqual(
    turn.turned.snake[0],
    ahead(turn.before.snake[0], "up"),
    "the head after the tick",
  );
});
