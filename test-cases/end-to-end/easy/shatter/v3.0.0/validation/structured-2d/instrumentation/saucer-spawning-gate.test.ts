// instrumentation/saucer-spawning-gate — with `setSaucerSpawning(false)` no
// saucer joins; with it on, one does.
//
// THE RULE. `specs/instrumentation.md`, The world gates: "`setSaucerSpawning
// (enabled)` gates the game's own arrival of a saucer, at `SAUCER_FIRST_DELAY`
// and at the gaps after it. Off, no saucer appears unless one is added."
//
// THE CADENCE IS STARTED FROM THE BEGINNING OF A GAME. `reset` "returns the
// saucer's arrival clock to the start of a game's cadence"
// (`specs/instrumentation.md`), so each leg resets first and then poses live
// play over it. Without that the clock would be wherever the previous scenario
// left it, and "no saucer past the first delay" would be a claim about a clock
// that had already run.
//
// THE WINDOW IS THE FIRST DELAY AND TWO SECONDS OVER, chosen from the
// specification rather than from patience: `specs/saucer.md` puts the first
// arrival of a game at `SAUCER_FIRST_DELAY` (`18` seconds), so a gate that does
// nothing has let a saucer in by the time the window closes, and a gate that
// works has held the one arrival the cadence owed inside it. The gate's hold
// over LATER arrivals follows from the same faculty, and a watch past the first
// delay would grade the cadence's gaps a second time.
//
// THE FIELD IS OTHERWISE EMPTY AND QUIET. The wave gate stays shut and the
// ship's contact test with it, so the only thing that can appear on the field
// over the window is the saucer this item is about.
//
// A FRAME IS WORTH EIGHT TICKS HERE. `specs/simulation.md` converts whatever
// delta a frame brings into whole ticks, so twenty seconds of game time reach
// the same state however they are divided into frames, and what the watch reads
// is the saucer slot alone: a visit lasts `SAUCER_LIFETIME` (`12` s), which no
// stride of a fifteenth of a second can step over.

import { ConstantClock } from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRST_DELAY } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  TICK_MS,
  ticksFor,
  type Harness,
} from "../harness";

/** How long each leg watches for, in seconds of game time. See the header. */
const WATCH_SECONDS = SAUCER_FIRST_DELAY + 2;

/** The whole ticks one frame of the watch is worth: a fifteenth of a second. */
const WATCH_TICKS_PER_FRAME = 8;

/** The frames covering the window at that stride. */
const WATCH_FRAMES = Math.ceil(ticksFor(WATCH_SECONDS) / WATCH_TICKS_PER_FRAME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness({
    clock: new ConstantClock(TICK_MS * WATCH_TICKS_PER_FRAME),
  });
});

afterEach(() => {
  h?.dispose();
});

it("off, no saucer joins past the first delay", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setSaucerSpawning(false);
  assertNull(h.snapshot().saucer, "no saucer is up when the leg begins");

  // Undrawn: twenty seconds of game time is 300 frames of eight ticks, and what
  // the sweep reads is the saucer slot. The frame it stops on, and the state it
  // reports, are the same either way.
  const arrived = await h.quiet(() =>
    h.until((s) => s.saucer !== null, {
      maxFrames: WATCH_FRAMES,
      poll: 1,
    }),
  );

  // The field with no saucer past the first delay, on a frame drawn for it.
  await h.paint();
  captureStill(h, "quiet");

  assertEqual(
    arrived.hit,
    false,
    `with saucerSpawning off, no saucer appears over ${WATCH_SECONDS} s of ` +
      `game time — past the ${SAUCER_FIRST_DELAY} s specs/saucer.md puts the ` +
      "first arrival of a game at",
  );
  assertNull(h.snapshot().saucer, "the saucer slot is still empty");
});

it("on, one joins inside the same window", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setSaucerSpawning(true);
  assertNull(h.snapshot().saucer, "no saucer is up when the leg begins");

  const arrived = await h.quiet(() =>
    h.until((s) => s.saucer !== null, {
      maxFrames: WATCH_FRAMES,
      poll: 1,
    }),
  );
  assertEqual(
    arrived.hit,
    true,
    `with saucerSpawning on, the game's own arrival brings a saucer in ` +
      `within ${WATCH_SECONDS} s of game time (specs/saucer.md)`,
  );
});
