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
// THE WINDOW IS SIXTY SECONDS, WHICH IS MORE THAN THREE FIRST DELAYS. Long enough
// that a build whose arrival is merely LATE is not mistaken for one whose gate
// works, and long enough to cover the widest gap `specs/saucer.md` allows between
// visits (`SAUCER_GAP_MAX`, 35 seconds) as well.
//
// THE SWEEP READS EVERY TICK, NOT THE END. A visit is finite —
// `SAUCER_LIFETIME` (12 seconds) and the craft leaves — so a saucer that arrived at
// eighteen seconds and left at thirty is invisible to a reading taken at sixty. The
// OFF leg therefore stops at the first tick a saucer is up, and reports that tick.
//
// AND THE CLOCK IS PUT BACK TO THE START OF A GAME'S CADENCE FIRST.
// `specs/instrumentation.md` has `reset` return "the saucer's arrival clock to the
// start of a game's cadence", so both legs are measured from a known zero rather
// than from wherever the harness's own initialization left it. The seed is fixed
// too, since `specs/saucer.md` draws the later gaps at random and a check should
// not turn on which numbers a build happened to draw.
//
// The field is otherwise empty and the wave loop is shut, so nothing but the gate
// can put a body on it.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRST_DELAY } from "../../src/constants";
import { assertNull, assertTrue, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The seed both legs are opened on, so neither turns on a lucky draw. */
const SEED = 5;

/** The game time each leg watches for, in ticks: three first delays and more. */
const WATCH_FRAMES = ticksFor(60);

/**
 * How long the ON leg is allowed to wait for the first arrival, in ticks.
 *
 * `SAUCER_FIRST_DELAY` (18 seconds) plus a second of slack, which bounds a build
 * that never brings one on rather than fixing the moment: the moment itself is
 * `saucer/first-arrives-at-18s`'s to decide, and this item only asks that the
 * gate lets an arrival happen at all.
 */
const ARRIVAL_FRAMES = ticksFor(SAUCER_FIRST_DELAY + 1);

let h: Harness;

/** Open a quiet, empty run at the start of a game's saucer cadence. */
function openRun(gate: boolean): void {
  h.debug.reset({ seed: SEED });
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
  const watched = await h.until((s) => s.saucer !== null, {
    maxFrames: WATCH_FRAMES,
    poll: 1,
  });
  captureStill(h, "quiet");
  assertNull(
    watched.snapshot.saucer,
    "the saucer slot over a minute of game time with setSaucerSpawning(false) " +
      `(first seen at ${(watched.frames / ticksFor(1)).toFixed(2)} s)`,
  );

  // ---- And the same minute with the gate open -----------------------------
  openRun(true);
  const arrived = await h.until((s) => s.saucer !== null, {
    maxFrames: ARRIVAL_FRAMES,
    poll: 1,
  });
  assertTrue(
    arrived.hit,
    "a saucer arrived with setSaucerSpawning(true), within a second of " +
      "SAUCER_FIRST_DELAY (specs/saucer.md)",
  );
  assertLessThanOrEqual(
    arrived.snapshot.simTime,
    SAUCER_FIRST_DELAY + 1,
    "the game time the first arrival came at, in seconds",
  );
});
