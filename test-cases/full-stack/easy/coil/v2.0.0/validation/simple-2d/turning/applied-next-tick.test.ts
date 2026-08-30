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
import { BINDINGS } from "../../src/constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/** Where the chain is posed: clear board above it and to its right. */
const HEAD: Cell = { col: 10, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("buffers the request, and applies it on the next tick", async () => {
  const posed = arrangeStep(h, { head: HEAD, dir: "right", length: 3 });

  const turn = await captureReplay(h, "turn", async () => {
    await h.tap(BINDINGS.up[0]);
    const requested = h.snapshot();
    return { requested, turned: await h.tick() };
  });

  // At the call: nothing moved, the heading is the old one, and the request is
  // waiting on the buffer. The frame the press was delivered on is a fraction of
  // a tick, so no tick has resolved on it.
  assertEqual(turn.requested.ticks, 0, "ticks at the request");
  assertEqual(turn.requested.dir, "right", "dir at the request");
  assertDeepEqual(
    turn.requested.snake,
    posed.snapshot.snake,
    "the chain at the request",
  );
  assertDeepEqual(turn.requested.turns, ["up"], "the buffered request");

  // On the next tick: step 1 applied it, and the head advanced the new way.
  assertEqual(turn.turned.dir, "up", "dir after the tick");
  assertDeepEqual(
    turn.turned.snake[0],
    ahead(HEAD, "up"),
    "the head after the tick",
  );
});
