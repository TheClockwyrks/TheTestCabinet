// hud/clock-format — the run clock counts up as `m:ss`.
//
// WHERE THE FIGURES COME FROM. specs/ui.md ("`playing`", the HUD table):
// "Clock | The run clock as `m:ss`, counting up from `0:00` in whole seconds,
// the seconds always two digits." specs/instrumentation.md gives the clock its
// figure: `time` is `tick / TICK_HZ` seconds, with `TICK_HZ` `60`. So tick 300
// is 5 seconds and reads `0:05`, which is where the two-digit rule shows; tick
// 4020 is 67 seconds and reads `1:07`; tick 4050 is 67.5 seconds and still
// reads `1:07`, which is where whole seconds show; and tick 35999, the last
// tick of the night, is 599.98 seconds and reads `9:59`.
//
// THE WORLD. Four isolated `playing` runs, each posed through `isolate`, which
// resets first, then posed one tick short of the tick the frame is about. The
// clock is the only thing the pose moves: with `spawning`, `events`, and
// `despawning` off no enemy arrives however late the clock is posed
// (specs/instrumentation.md, the driver switches), and specs/instrumentation.md
// (`setTick`) states the pose's own reach, "Nothing else changes: `spawnTimer`,
// `firedEvents`, and every live entity stay as they stand".
//
// WHY ONE TICK SHORT. specs/world.md ("One tick") runs the clock first, "`tick`
// rises by one, and every phase below reads the new value", and the frame draws
// what the tick it consumed left, so a frame posed at tick `t - 1` is the frame
// AT tick `t`. Each check reads `tick` back off the snapshot to say so.
//
// WHAT IS READ. Every run of text each frame drew, and whether one of them
// holds the reading the clock owes. The reading is taken as part of a longer
// run, so a build that draws the clock beside other copy still reads.
//
// TOLERANCE. None: the four readings are exact strings, and the tick each is
// read at is a whole number the pose fixed.

import type { Canvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK, TICK_HZ } from "../constants";
import {
  createHarness,
  isolate,
  type DrawCall,
  type Harness,
} from "../harness";
import { assertDrewPhrase, captureFrames, keepFrame } from "./hud";

/** The tick each frame is drawn at, and the reading `m:ss` owes there. */
const READINGS: readonly { tick: number; clock: string; why: string }[] = [
  { tick: 5 * TICK_HZ, clock: "0:05", why: "5 seconds, the seconds padded" },
  { tick: 67 * TICK_HZ, clock: "1:07", why: "67 seconds, a minute and seven" },
  {
    tick: 67 * TICK_HZ + TICK_HZ / 2,
    clock: "1:07",
    why: "67.5 seconds, counted in whole seconds",
  },
  {
    tick: DAWN_TICK - 1,
    clock: "9:59",
    why: "the last tick of the night, 599.98 seconds",
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws 0:05, 1:07, 1:07, and 9:59 at ticks 300, 4020, 4050, and 35999", async () => {
  const frames: Canvas[] = [];
  const drew: { drawn: DrawCall[]; tick: number }[] = [];
  for (const reading of READINGS) {
    isolate(h);
    h.debug.setTick(reading.tick - 1);
    const { calls } = await h.frameDraw();
    frames.push(keepFrame(h));
    drew.push({ drawn: calls, tick: h.snapshot().run.tick });
  }
  captureFrames(frames, "clock");

  READINGS.forEach((reading, at) => {
    assertEqual(
      drew[at].tick,
      reading.tick,
      `the tick the frame drew at (${reading.why})`,
    );
    assertDrewPhrase(
      drew[at].drawn,
      reading.clock,
      `the clock at tick ${reading.tick}, ${reading.why}`,
    );
  });
});
