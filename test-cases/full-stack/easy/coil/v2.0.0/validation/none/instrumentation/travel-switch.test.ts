// instrumentation/travel-switch — `setSnakeTravel(false)` holds the chain on the
// cells it stands on while the rest of the tick carries on.
//
// WHAT THE SWITCH IS FOR. specs/instrumentation.md: with `travel` off "the head
// does not advance, so steps 2 to 5 do not run: nothing collides, nothing is
// eaten, and the chain holds the cells it stands on however long the scenario
// runs", and "its steering is untouched: a buffered turn is still taken and
// `dir` still changes". Both halves are the requirement, and the combo points
// that drain a window over 28 ticks without moving the snake rest on it.
//
// THE HEAD IS POSED ONE CELL FROM A WALL, so a build whose switch does not really
// hold the chain does not merely drift: it dies within one tick, and the screen
// reading says so. Running far more ticks than it would take to reach the wall is
// what makes the reading mean "however long the scenario runs".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  arrangeApproach,
  captureReplay,
  createHarness,
  WALL_CELL,
  type Harness,
} from "../harness";

/** Ticks run with the switch off: many times the one it would take to hit the wall. */
const HELD_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the chain still over many ticks, and still takes a turn", async () => {
  const posed = await arrangeApproach(h, WALL_CELL, {
    dir: "left",
    travel: false,
  });
  assertEqual(posed.snapshot.travel, false, "the switch the scene posed");
  assertDeepEqual(posed.snapshot.snake[0], posed.head, "the posed head");

  const held = await captureReplay(h, "held", () => h.tick(HELD_TICKS));

  assertEqual(held.ticks, HELD_TICKS, "ticks resolved while the switch was off");
  assertDeepEqual(held.snake, posed.snapshot.snake, "the chain with travel off");
  assertEqual(held.screen, "playing", "the screen with travel off");

  // Steering is untouched: the request is taken and `dir` changes, so the snake
  // sets off the new way the moment travel is turned back on.
  await h.tap(KEY.up);
  const turned = await h.tick();
  assertEqual(turned.dir, "up", "dir after a request with travel off");
  assertDeepEqual(turned.snake, posed.snapshot.snake, "the chain after the turn");
});
