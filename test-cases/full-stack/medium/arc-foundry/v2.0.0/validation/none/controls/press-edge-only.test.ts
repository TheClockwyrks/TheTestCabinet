// controls/press-edge-only — every action but `modify` is read as a press edge.
//
// THE REQUIREMENT. `specs/controls.md` states it once, for the whole table:
// "Every action but `modify` is read as a press edge, so holding its key fires it
// once." A build that samples the key's held state each frame and acts on it fires
// the action every frame the key is down, which turns one press of the speed key
// into sixty steps of the multiplier and makes the game unusable with a keyboard.
//
// HOW IT IS DECIDED. `speed` is the action to decide it on, because it is the one
// whose repeats are individually countable: the multiplier is a four-entry cycle,
// so one activation moves it one place and any other number of activations lands
// somewhere the single step does not. The key is HELD — a real browser key held
// down on the page, never released between frames — across sixty frames of
// simulation, and the multiplier is read afterwards. One step, whatever the frame
// count.
//
// WHY SIXTY FRAMES. Long enough that a per-frame reader would have gone round the
// four-entry cycle fifteen times, and not a multiple of the cycle length either,
// so a build firing on every frame cannot land back on the right answer by luck.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { SPEEDS, keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Frames the key is held down for. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps the multiplier once for a key held across sixty frames", async () => {
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
