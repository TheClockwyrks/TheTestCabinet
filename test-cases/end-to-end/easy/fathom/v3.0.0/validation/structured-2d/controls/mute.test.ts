// controls/mute — KeyM toggles the game's sound, and a muted dive sounds nothing.
//
// specs/movement.md binds the `mute` action to `KeyM` and gives it one job:
// "Toggles the game's sound". Every screen reads it, `"playing"` included.
// specs/progression.md fixes what the toggle does and what the flag means: "A
// session opens with sound on, so `muted` is `false` until the mute control is
// used"; "While `muted` is on, no cue sounds. The events that raise cues still
// happen and the game plays exactly as it does unmuted, and only the sound
// stops"; and "Clearing the toggle restores the cues from the next event on."
//
// WHY THE MEASUREMENT RUNS IN THE MAZE. Muting is defined as part of audio, and
// every cue specs/progression.md names is something that happens inside a dive.
// Reading the flag back on a menu screen would ask a build for a binding on a
// screen whose sound the specification never fixes. The toggle is driven where it
// does something, and what it does is what is read: the forager emitting a sonar
// pulse is the one cue a scenario can raise on demand, so it is what mute is
// measured against.
//
// WHAT IS COUNTED: AUDIBLE cues, whatever their name. The engine owns muting
// (specs/progression.md), and it announces a cue whether or not anything is
// heard, carrying the gain it sounded at — so a muted play is announced at gain
// zero rather than not announced. "No cue sounds" is therefore a count of the
// plays with gain above zero, which is exactly what a player hears. WHICH cue a
// sonar pulse must play is `audio/sonar`'s question, and counting every name is
// what keeps the two points apart.
//
// THE BOARD IS EMPTY FOR THE COUNT. A posed fixture carries no predator, no
// drifter and no plankton (`fixtures.ts`), so the only thing in either window that
// can raise a cue is the pulse this check emits. A Gloamfin left on the board pings on
// its own cadence, and a ping in the unmuted window would let a build that never
// sounded the pulse pass on somebody else's noise.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { BINDINGS, BRIGHT_HOLD } from "../constants";
import { poseStraightRun } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

/** The key specs/movement.md binds the `mute` action to. */
const MUTE_KEY = BINDINGS.mute[0];

/** The key specs/movement.md binds the `a` action to, which emits the pulse. */
const SONAR_KEY = BINDINGS.a[0];

/** A corridor long enough that the lit pocket in the still reads as maze. */
const RUN_TILES = 12;

/**
 * Brightness posed for the picture alone.
 *
 * `G = 1` puts the light radius `V` at its widest, `160` units
 * (specs/sensing.md). Nothing this point asserts reads brightness.
 */
const LIT = 1;

/**
 * Ticks between a press and the reading it settles.
 *
 * A beat, not a measurement: `tap` runs the one tick that delivers the key, and
 * these follow it. specs/state.md has `muted` be "the game's readable copy of the
 * runtime's mute bit, refreshed every frame", so a build that mirrors the bit at
 * the top of the next frame reads the same as one that mirrors it in the
 * controller's own tick.
 */
const BEAT_TICKS = 4;

/**
 * How long each cue window runs, in ticks.
 *
 * A quarter of a second past the press. specs/progression.md has a cue played "on
 * the tick its event happens", so a conforming build has sounded well inside this
 * — and a build that sounds nothing has had a quarter of a second in which not
 * to, which is what makes the muted reading a finding rather than an observation
 * that has not waited long enough.
 */
const CUE_WINDOW_TICKS = 30;

/**
 * How many cues the build has actually SOUNDED so far.
 *
 * The bus announces every play, muted or not, and reports the gain it sounded at;
 * a muted play carries gain zero. What a player hears is the plays above zero.
 */
function audible(harness: Harness): number {
  return harness.cues.filter((cue) => cue.gain > 0).length;
}

/**
 * How many cues the build has ASKED for so far, whatever they sounded at.
 *
 * The same log, counted without the gain. A muted play is announced at gain zero
 * rather than not announced, so the two counts together separate a mute that was
 * never cleared — plays announced, none of them audible — from a build that never
 * plays the pulse's cue at all, which is audio/sonar's verdict rather than this
 * point's.
 */
function announced(harness: Harness): number {
  return harness.cues.length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("toggles mute on KeyM, and a muted dive sounds nothing", async () => {
  startPlaying(h);
  await poseStraightRun(h, RUN_TILES);
  await parkForager(h);
  h.debug.setBrightness(LIT);
  h.debug.setBrightHold(BRIGHT_HOLD);
  const watch = await sceneGuard(h);

  const opening = h.snapshot();

  // Muted.
  await h.tap(MUTE_KEY);
  await h.advance(BEAT_TICKS);
  const muted = h.snapshot();

  h.debug.setSonarCooldown(0);
  const quietFrom = audible(h);
  await h.tap(SONAR_KEY);
  await h.advance(CUE_WINDOW_TICKS);
  const mutedSounds = audible(h) - quietFrom;
  const mutedPulses = h
    .snapshot()
    .pulses.filter((pulse) => pulse.source === "forager").length;
  // Before the assertions, so a check that fails still leaves the picture that
  // shows why: a muted dive with the forager's own pulse flooding the corridor.
  captureStill(h, "mute");

  // And unmuted.
  await h.tap(MUTE_KEY);
  await h.advance(BEAT_TICKS);
  const unmuted = h.snapshot();

  h.debug.setSonarCooldown(0);
  const loudFrom = audible(h);
  const loudPlaysFrom = announced(h);
  await h.tap(SONAR_KEY);
  await h.advance(CUE_WINDOW_TICKS);
  const unmutedSounds = audible(h) - loudFrom;
  const unmutedPlays = announced(h) - loudPlaysFrom;

  requireSceneHeld(h.snapshot(), watch);

  assertEqual(
    opening.muted,
    false,
    "a session opens with sound on (specs/progression.md)",
  );
  assertEqual(muted.muted, true, "pressing KeyM turns muting on");
  assertEqual(unmuted.muted, false, "pressing KeyM again turns it off");

  // The event happened either way — "The events that raise cues still happen and
  // the game plays exactly as it does unmuted, and only the sound stops" — so a
  // build that silenced the pulse by not emitting it is not the one this point
  // passes.
  assertGreaterThan(
    mutedPulses,
    0,
    "the muted dive still emitted the pulse, so what is counted below is the " +
      "sound of an event that happened",
  );
  assertEqual(
    mutedSounds,
    0,
    `cues the build SOUNDED over ${CUE_WINDOW_TICKS} ticks of a MUTED dive ` +
      `around its own sonar pulse`,
  );
  // A build that plays no cue for its own pulse has nothing for the toggle to
  // restore, and "clearing the toggle restores the cues" cannot be read on a cue
  // that was never asked for.
  if (unmutedPlays === 0) {
    fail(
      "the unmuted dive asking the bus for a cue on its own sonar pulse, which " +
        "is what specs/progression.md's \"Clearing the toggle restores the cues " +
        'from the next event on" is read on',
      `the build announced no cue at all over ${CUE_WINDOW_TICKS} ticks around ` +
        `the pulse`,
    );
  }
  assertGreaterThan(
    unmutedSounds,
    0,
    `cues the build SOUNDED over ${CUE_WINDOW_TICKS} ticks of the same dive ` +
      `UNMUTED, around the same pulse`,
  );
});
