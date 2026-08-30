// instrumentation/steering-switch — `setSnakeSteering(false)` holds the snake's
// heading while it keeps travelling.
//
// WHAT THE SWITCH IS FOR. specs/instrumentation.md gives the driver three
// switches rather than one, "because a scenario holds one faculty still while it
// watches another". With `steering` off, step 1 of the tick "takes nothing and no
// request is taken into the buffer, so `turns` stays empty and `dir` holds the
// value it carries", while "the head still advances each tick along `dir`". Both
// halves are the requirement: a switch that also froze the snake would be a
// different switch, and every later point that holds a heading still while the
// chain runs rests on this one.
//
// THE REQUESTS ARE REAL KEY PRESSES because a steering request has no other
// source: the surface carries no operation that buffers one, so the keyboard is
// what a request arrives on. What is decided here is what the switch does with
// them, not the bindings, which the `controls` points own.

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps turns empty and dir fixed while the head keeps advancing", async () => {
  const posed = await arrangeStep(h, {
    head: HEAD,
    dir: "right",
    length: 3,
    steering: false,
  });
  assertEqual(posed.snapshot.steering, false, "the switch the scene posed");

  const held = await captureReplay(h, "held", async () => {
    for (const key of REQUESTS) {
      await h.tap(key);
      await h.tick();
    }
    return h.snapshot();
  });

  // Not one request was taken, and the heading is the one the scene posed.
  assertDeepEqual(held.turns, [], "turns with steering off");
  assertEqual(held.dir, "right", "dir with steering off");

  // And travel is untouched: the head advanced one cell along `dir` for each
  // tick that resolved, which is the other half of what the switch promises.
  assertGreaterThan(held.ticks, 0, "ticks resolved while the switch was off");
  assertDeepEqual(
    held.snake[0],
    ahead(HEAD, "right", held.ticks),
    "the head after the ticks that resolved",
  );

  // Turning the switch back on takes requests again, from wherever the game
  // stands, with no catching up for the ticks it was off.
  await h.debug.setSnakeSteering(true);
  await h.tap(KEY.up);
  const taken = await h.snapshot();
  assertDeepEqual(taken.turns, ["up"], "turns with steering back on");
  assertEqual((await h.tick()).dir, "up", "dir on the tick after the request");
});
