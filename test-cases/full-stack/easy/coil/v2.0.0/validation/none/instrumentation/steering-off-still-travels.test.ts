// instrumentation/steering-off-still-travels — the switch holds the steering
// alone, so the head keeps advancing.
//
// specs/instrumentation.md, with `steering` off: "The head still advances each
// tick along `dir`." That no request is taken and `dir` does not move is the
// other half of the switch and is
// `instrumentation/steering-off-holds-heading`.
//
// WHAT THE SWITCHES ARE FOR. specs/instrumentation.md gives the driver three
// switches rather than one, "because a scenario holds one faculty still while it
// watches another". A switch that also held the other faculty would be a
// different switch, so each half of what one promises is its own point.
//
// THE REQUESTS ARE REAL KEY PRESSES because a steering request has no other
// source: the surface carries no operation that buffers one, so the keyboard is
// what a request arrives on. What is decided here is what the switch does with
// them, not the bindings, which the `controls` points own.
//
// THE BRACKET AROUND THE RECORDING runs the scene up before the behaviour and
// settles after it, so what a reviewer watches is the chain already travelling
// when the moment arrives and still there afterwards, rather than a single tick
// cut out of the middle.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { KEY, type Cell } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Where the chain is posed: row 8 with a long clear run to its right. */
const HEAD: Cell = { col: 8, row: 8 };

/** Every direction a request can name, pressed one per tick with steering off. */
const REQUESTS = [KEY.up, KEY.down, KEY.left, KEY.right] as const;

/** Ticks of travel before and after the run of requests. */
const RUN_UP = 2;
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances the head one cell a tick while the switch is off", async () => {
  const posed = await arrangeStep(h, {
    head: HEAD,
    dir: "right",
    length: 3,
    steering: false,
  });
  assertEqual(posed.snapshot.steering, false, "the switch the scene posed");

  const travelled = await captureReplay(h, "travelling", async () => {
    await h.tick(RUN_UP);
    for (const key of REQUESTS) {
      await h.tap(key);
      await h.tick();
    }
    const after = await h.snapshot();
    await h.tick(SETTLE);
    return after;
  });

  // One cell along `dir` for every tick that resolved, and not one of the
  // requests turned it.
  assertGreaterThan(
    travelled.ticks,
    0,
    "ticks resolved while the switch was off",
  );
  assertDeepEqual(
    travelled.snake[0],
    ahead(HEAD, "right", travelled.ticks),
    "the head after the ticks that resolved",
  );
});
