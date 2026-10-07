// controls/press-edge-only — every action but `modify` is read as a press edge.
//
// THE REQUIREMENT. `specs/controls.md` states it once, for the whole table:
// "Every action but `modify` is read as a press edge, so holding its key fires it
// once." A build that samples the key's held state each frame and acts on it fires
// the action every frame the key is down, which turns one press of the speed key
// into a step of the multiplier on every frame and makes the game unusable with a
// keyboard.
//
// HOW IT IS DECIDED. `speed` is the action to decide it on, because it is the one
// whose repeats are individually countable: the multiplier is a four-entry cycle,
// so one activation moves it one place and a count that is not one place round
// the cycle lands somewhere the single step does not. The key is HELD — a real
// browser key held down on the page, never released between frames — across
// sixty-two frames of simulation, and the multiplier is read afterwards. One
// step, whatever the frame count.
//
// WHY SIXTY-TWO FRAMES. Long enough that a per-frame reader would have gone round
// the four-entry cycle more than fifteen times, and chosen so that neither count
// a per-frame reader can produce lands on the answer a single press gives. A
// build that fires on the edge AND on every frame the key is down activates the
// action `1 + 62` times, and one that only samples the held state activates it
// `62`; `63` and `62` are two and three places round a four-entry cycle, and the
// single press is one. A round number of frames would not do: sixty is a whole
// number of cycles, so a per-frame reader would land exactly where one press
// lands and pass this point while being unusable with a keyboard.
//
// WHAT THIS CANNOT DECIDE. A key held down on a real keyboard also delivers the
// operating system's auto-repeat, and a driven key does not, so a build that
// latches every repeat as a fresh press is indistinguishable here from one that
// reads the first edge alone. What is decided is the failure the requirement
// names: a build that acts on the key's held state frame after frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { keyFor, SPEEDS } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Frames the key is held down for. Never a whole number of speed cycles. */
const HELD_FRAMES = 62;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps the multiplier once for a key held across sixty-two frames", async () => {
  await openYard(h);

  const start = (await h.snapshot()).speed;
  const from = SPEEDS.indexOf(start);
  assertGreaterThanOrEqual(
    from,
    0,
    `the speed multiplier to be one of ${SPEEDS.join(", ")} ` +
      "(specs/instrumentation.md)",
  );

  await h.hold(keyFor("speed"));
  try {
    await h.advance(HELD_FRAMES);
    await captureStill(h, "edge");

    assertEqual(
      (await h.snapshot()).speed,
      SPEEDS[(from + 1) % SPEEDS.length],
      `the multiplier after ${keyFor("speed")} was held down across ` +
        `${HELD_FRAMES} frames, which fires the action once because every ` +
        "action but modify is read as a press edge (specs/controls.md)",
    );
  } finally {
    await h.release(keyFor("speed"));
  }
});
