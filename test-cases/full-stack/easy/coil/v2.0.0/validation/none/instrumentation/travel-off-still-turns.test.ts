// instrumentation/travel-off-still-turns — the switch holds the travel alone, so
// a buffered turn is still taken.
//
// specs/instrumentation.md, with `travel` off: "its steering is untouched: a
// buffered turn is still taken and `dir` still changes, so the snake sets off in
// the new direction the moment travel is turned back on". That the chain does not
// move meanwhile is the other half of the switch and is
// `instrumentation/travel-off-holds-the-chain`.
//
// THE HEAD IS POSED ONE CELL FROM A WALL, so a build whose switch does not really
// hold the chain dies within a tick rather than drifting, and the screen reading
// beside the direction says which failure it was.
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
import { assertDeepEqual, assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  WALL_CELL,
  arrangeApproach,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Ticks run before the request, and after the tick that applies it. */
const RUN_UP = 3;
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a buffered turn and changes dir with travel off", async () => {
  const posed = await arrangeApproach(h, WALL_CELL, {
    dir: "left",
    travel: false,
  });
  assertEqual(posed.snapshot.travel, false, "the switch the scene posed");

  const turned = await captureReplay(h, "turned", async () => {
    await h.tick(RUN_UP);
    await h.tap(KEY.up);
    const after = await h.tick();
    await h.tick(SETTLE);
    return after;
  });

  assertEqual(turned.dir, "up", "dir after a request with travel off");
  assertDeepEqual(
    turned.snake,
    posed.snapshot.snake,
    "the chain after the turn",
  );
});
