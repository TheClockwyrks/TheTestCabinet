// instrumentation/travel-off-holds-the-chain — with the switch off, the chain
// holds the cells it stands on.
//
// specs/instrumentation.md, with `travel` off: "the head does not advance, so
// steps 2 to 5 do not run: nothing collides, nothing is eaten, and the chain
// holds the cells it stands on however long the scenario runs". That a buffered
// turn is still taken is the other half of the switch and is
// `instrumentation/travel-off-still-turns`.
//
// THE HEAD IS POSED ONE CELL FROM A WALL, so a build whose switch does not really
// hold the chain does not merely drift: it dies within one tick, and the screen
// reading says so. Running far more ticks than it would take to reach the wall is
// what makes the reading mean "however long the scenario runs".
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

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  WALL_CELL,
  arrangeApproach,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Ticks run with the switch off: many times the one it would take to hit the wall. */
const HELD_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the chain still over many ticks with travel off", async () => {
  const posed = arrangeApproach(h, WALL_CELL, {
    dir: "left",
    travel: false,
  });
  assertEqual(posed.snapshot.travel, false, "the switch the scene posed");
  assertDeepEqual(posed.snapshot.snake[0], posed.head, "the posed head");

  const held = await captureReplay(h, "held", () => h.tick(HELD_TICKS));

  assertEqual(
    held.ticks,
    HELD_TICKS,
    "ticks resolved while the switch was off",
  );
  assertDeepEqual(
    held.snake,
    posed.snapshot.snake,
    "the chain with travel off",
  );
  assertEqual(held.screen, "playing", "the screen with travel off");
});
