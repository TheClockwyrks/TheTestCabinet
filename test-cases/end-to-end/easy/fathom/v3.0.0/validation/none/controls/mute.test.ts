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
// WHAT IS OBSERVED, AND WHY. An engineless build writes its whole audio layer,
// and specs/progression.md fixes the seven cue NAMES inside that code without
// fixing how a sound is made — so there is no bus to ask and no name to read.
// `watchCues` counts what goes through the two doors a browser can emit sound
// through and stamps each with the tick it sounded on. That is enough for this
// point: a muted dive must put nothing through them for an event that raises a
// cue, and an unmuted one must. WHICH cue sounded is `audio/sonar`'s question,
// and under this engine nobody can answer it.
//
// THE BOARD IS HELD STILL FOR THE COUNT. `setCreatureAI(false)` holds every
// creature exactly where it stands and leaves the rest of the simulation running
// — cooldowns, wavefronts and the forager's own controls all continue
// (specs/instrumentation.md) — so the only thing in either window that can raise
// a cue is the pulse this check emits. A Gloamfin left to its own mind pings on
// its own cadence, and a ping in the unmuted window would let a build that never
// sounded the pulse pass on somebody else's noise.
//
// THE AUDIO IS ARMED WITH A REAL GESTURE first. Sound starts only once the player
// has interacted with the page (specs/progression.md), and the key used carries no
// binding, so arming changes nothing about the game.

import { afterEach, beforeEach } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { poseStraightRun } from "../fixtures";
import {
  captureStill,
  createHarness,
  watchCues,
  type Harness,
  startPlaying,
} from "../harness";
import { check, quietBoard, requireSceneHeld, sceneGuard } from "../scene";

/** The key specs/movement.md binds the `mute` action to. */
const MUTE_KEY = "KeyM";

/** The key specs/movement.md binds the `a` action to, which emits the pulse. */
const SONAR_KEY = "Space";

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
 * the top of the next frame reads the same as one that mirrors it in the handler.
 */
const BEAT_TICKS = 4;

/**
 * How long each cue window runs, in ticks.
 *
 * A quarter of a second past the press. specs/progression.md has a cue played "on
 * the tick its event happens", so a conforming build has sounded well inside this
 * — and a build that sounds nothing has had a quarter of a second in which not
 * to, which is what makes the muted reading a finding rather than an
 * observation that has not waited long enough.
 */
const CUE_WINDOW_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

check("toggles mute on KeyM, and a muted dive sounds nothing", async () => {
  await startPlaying(h);
  await poseStraightRun(h, RUN_TILES);
  await quietBoard(h);
  await h.debug.setBrightness(LIT);
  await h.debug.setCreatureAI(false);
  await h.armAudio();
  const guard = await sceneGuard(h);

  const opening = await h.snapshot();
  const cues = watchCues(h);

  // Muted.
  await h.tap(MUTE_KEY);
  await h.advance(BEAT_TICKS);
  const muted = await h.snapshot();

  await h.debug.setSonarCooldown(0);
  const quietFrom = cues.length;
  await h.tap(SONAR_KEY);
  await h.advance(CUE_WINDOW_TICKS);
  const mutedSounds = cues.length - quietFrom;
  const mutedPulses = (await h.snapshot()).pulses.filter(
    (pulse) => pulse.source === "forager",
  ).length;
  // Before the assertions, so a check that fails still leaves the picture that
  // shows why: a muted dive with the forager's own pulse flooding the corridor.
  await captureStill(h, "mute");

  // And unmuted.
  await h.tap(MUTE_KEY);
  await h.advance(BEAT_TICKS);
  const unmuted = await h.snapshot();

  await h.debug.setSonarCooldown(0);
  const loudFrom = cues.length;
  await h.tap(SONAR_KEY);
  await h.advance(CUE_WINDOW_TICKS);
  const unmutedSounds = cues.length - loudFrom;

  requireSceneHeld(await h.snapshot(), guard);

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
    `sounds the build started over ${CUE_WINDOW_TICKS} ticks of a MUTED dive ` +
      `around its own sonar pulse`,
  );
  assertGreaterThan(
    unmutedSounds,
    0,
    `sounds the build started over ${CUE_WINDOW_TICKS} ticks of the same dive ` +
      `UNMUTED, around the same pulse`,
  );
});
