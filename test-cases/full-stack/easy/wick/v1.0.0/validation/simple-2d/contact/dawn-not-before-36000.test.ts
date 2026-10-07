// contact/dawn-not-before-36000 — the run plays on until tick 36000: the tick
// that carries the clock to 35999 leaves the run on playing.
//
// THE RULE, FROM THE SPEC. specs/world.md, Fallen and dawn: the Dawn row's
// condition is "tick equals DAWN_TIME × TICK_HZ (36000)", read at the end of
// each tick. A tick that ends with the clock at 35999 meets neither ending, so
// the run stays on playing with that clock.
//
// WHY 35999 IS POSED. A build that ended the night one tick early, on
// `tick >= 35999` or on the tick the clock LEFT 35999, ends this run; a
// conformant one plays one more tick. The last tick before dawn is the
// boundary that tells them apart.
//
// THE POSE. An isolated night with the clock posed to 35998 through setTick.
// Phase 1 of the next tick raises it to 35999. hp is the fresh run's 100 and
// nothing is on the field, so the fallen condition cannot hold either.
//
// THE TOLERANCE. None: the screen and the tick are discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** Two short of dawn, so the next tick lands on the last tick of the night. */
const POSED_TICK = DAWN_TICK - 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the run on playing at tick 35999", async () => {
  isolate(h);
  h.debug.setTick(POSED_TICK);
  assertEqual(h.snapshot().run.tick, POSED_TICK, "the clock as posed");

  const after = await h.tick(1);
  captureStill(h, "before");

  assertEqual(after.run.tick, DAWN_TICK - 1, "the clock after the tick");
  assertEqual(after.screen, "playing", "screen on the last tick before dawn");
});
