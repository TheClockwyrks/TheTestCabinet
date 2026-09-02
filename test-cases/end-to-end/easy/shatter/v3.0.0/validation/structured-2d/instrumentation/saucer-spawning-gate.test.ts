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
// left it, and "no saucer in sixty seconds" would be a claim about a clock that
// had already run.
//
// SIXTY SECONDS IS THE WINDOW, and it is chosen from the specification rather
// than from patience: `specs/saucer.md` puts the first arrival of a game at
// `SAUCER_FIRST_DELAY` (`18` seconds), so a minute is more than three times the
// wait the gate is holding off. A build whose gate merely DELAYS the arrival, or
// gates only the first one, is inside that window.
//
// THE FIELD IS OTHERWISE EMPTY AND QUIET. The wave gate stays shut and the
// ship's contact test with it, so the only thing that can appear on the field
// over the minute is the saucer this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRST_DELAY } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** How long each leg watches for, in seconds of game time. */
const WATCH_SECONDS = 60;

/** How often that watch samples, in frames. A visit lasts 12 s (1440). */
const WATCH_POLL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("off, no saucer joins over a minute of game time", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setSaucerSpawning(false);
  assertNull(h.snapshot().saucer, "no saucer is up when the leg begins");

  const arrived = await h.until((s) => s.saucer !== null, {
    maxFrames: ticksFor(WATCH_SECONDS),
    poll: WATCH_POLL,
  });

  // The field with no saucer a minute in.
  captureStill(h, "quiet");

  assertEqual(
    arrived.hit,
    false,
    `with saucerSpawning off, no saucer appears over ${WATCH_SECONDS} s of ` +
      `game time — more than three times the ${SAUCER_FIRST_DELAY} s ` +
      "specs/saucer.md puts the first arrival of a game at",
  );
  assertNull(h.snapshot().saucer, "the saucer slot is still empty");
});

it("on, one joins inside the same minute", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setSaucerSpawning(true);
  assertNull(h.snapshot().saucer, "no saucer is up when the leg begins");

  const arrived = await h.until((s) => s.saucer !== null, {
    maxFrames: ticksFor(WATCH_SECONDS),
    poll: WATCH_POLL,
  });
  assertEqual(
    arrived.hit,
    true,
    `with saucerSpawning on, the game's own arrival brings a saucer in ` +
      `within ${WATCH_SECONDS} s of game time (specs/saucer.md)`,
  );
});
