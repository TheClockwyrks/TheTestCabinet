// instrumentation/saucer-spawning-gate — `setSaucerSpawning(false)` shuts the
// game's own arrival of a saucer, so none joins; with the gate on, one does.
//
// WHAT THE GATE IS FOR. `specs/instrumentation.md`: off, "no saucer appears unless
// one is added". `specs/saucer.md` puts the first arrival of a game at
// `SAUCER_FIRST_DELAY` (18 seconds) of game time, and a saucer hunts the ship and
// fires aimed shots at it — so every scenario in this project that runs past
// eighteen seconds is, without this gate, a scenario with an armed enemy in it.
// That is why `startPlaying` shuts it and why a gate that does nothing would
// contaminate the long checks in `waves`, `rocks` and `flight` with an arrival
// none of them arranged.
//
// THE SHUT WINDOW IS THE FIRST DELAY AND TWO SECONDS OVER. `specs/saucer.md` puts
// the first arrival of a game at `SAUCER_FIRST_DELAY` (18 seconds), so a gate that
// does nothing has let a saucer in by the time the window closes. The gate's hold
// over LATER arrivals follows from the same faculty, and a watch past the first
// delay would grade the cadence's gaps a second time.
//
// AND THE OPEN WINDOW IS GENEROUS ON PURPOSE. That leg asks only that the gate let
// an arrival happen AT ALL. WHEN it happens is `saucer/first-arrives-at-18s`'s to
// decide, and a window closing on the first delay would make one late arrival cost
// a build two points. So the open leg allows the first delay plus the longest gap
// `specs/saucer.md` states plus five seconds, which is also the longest wait either
// arrival-clock model can produce: nothing in `specs/instrumentation.md` says
// whether a shut gate holds the arrival clock or lets it run, and both are
// conformant. A build arriving on the specification's own schedule stops the watch
// at eighteen seconds and pays for none of the margin.
//
// THE SWEEP READS EVERY TICK, NOT THE END. A visit is finite —
// `SAUCER_LIFETIME` (12 seconds) and the craft leaves — so a saucer that arrived
// at eighteen seconds and left would be invisible to a reading taken later. The
// OFF leg therefore stops at the first tick a saucer is up, and reports that tick.
//
// AND THE CLOCK IS PUT BACK TO THE START OF A GAME'S CADENCE FIRST.
// `specs/instrumentation.md` has `reset` return "the saucer's arrival clock to the
// start of a game's cadence", so both legs are measured from a known zero rather
// than from wherever the harness's own initialization left it. The first arrival
// is the one watched for, and `specs/saucer.md` fixes when it comes.
//
// The field is otherwise empty and the wave loop is shut, so nothing but the gate
// can put a body on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull, assertTrue } from "../assert";
import { SAUCER_FIRST_DELAY, SAUCER_GAP_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The ticks the shut gate is watched over: the first delay and two seconds. */
const QUIET_TICKS = ticksFor(SAUCER_FIRST_DELAY + 2);

/**
 * The ticks the open gate is given to produce a saucer: the first delay, the
 * longest gap, and five seconds on top. See the header.
 */
const ARRIVAL_TICKS = ticksFor(SAUCER_FIRST_DELAY + SAUCER_GAP_MAX + 5);

let h: Harness;

/** Open a quiet, empty run at the start of a game's saucer cadence. */
function openRun(gate: boolean): void {
  h.debug.reset();
  startPlaying(h);
  h.debug.setSaucerSpawning(gate);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the saucer away with the gate off, and lets one arrive with it on", async () => {
  // ---- The gate shut ------------------------------------------------------
  openRun(false);
  // Undrawn: twenty seconds of game time sampled every tick is 2 400 frames, and
  // what the sweep reads is the saucer slot. The tick it stops on, and the state
  // it reports, are the same either way.
  const watched = await h.quiet(() =>
    h.until((s) => s.saucer !== null, {
      maxFrames: QUIET_TICKS,
      poll: 1,
    }),
  );
  // One drawn tick, so the still is the empty field the sweep just watched.
  await h.advance(1);
  captureStill(h, "quiet");
  assertNull(
    watched.snapshot.saucer,
    "the saucer slot past the first delay with setSaucerSpawning(false) " +
      `(first seen at ${(watched.frames / ticksFor(1)).toFixed(2)} s)`,
  );

  // ---- And the open gate, over a window that grades nothing but the gate ---
  openRun(true);
  const arrived = await h.quiet(() =>
    h.until((s) => s.saucer !== null, {
      maxFrames: ARRIVAL_TICKS,
      poll: 1,
    }),
  );
  assertTrue(
    arrived.hit,
    `a saucer arrived within ${SAUCER_FIRST_DELAY + SAUCER_GAP_MAX + 5} s of ` +
      "game time with setSaucerSpawning(true) (specs/saucer.md)",
  );
});
