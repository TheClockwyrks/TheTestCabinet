// controls/mute-m — `KeyM` toggles the game's sound.
//
// specs/controls.md binds the `mute` action to `KeyM` alone and gives it one
// effect — "Toggles sound, from any screen" — read as a press edge, "once per
// press". specs/ui.md hands the bit itself to the engine — "Muting and the
// first-interaction unlock belong to the engine. The game binds the `mute`
// action to the engine's mute bit" — and specs/instrumentation.md reports that
// bit as the snapshot's `muted`. So: pose live play, press the key, and read the
// bit; press it again, and read it back.
//
// THE READING IS RELATIVE, not absolute. Where the engine's mute bit rests
// before anybody touches it is the ENGINE's business, and no spec in this case
// fixes it, so this point reads the bit it found and requires the key to turn it
// over and back. A build that opens muted and one that opens unmuted both pass,
// and only a key that fails to flip the bit fails.
//
// MUTE IS REACHED THROUGH THE REAL BINDING because there is nothing else to
// reach it with: specs/instrumentation.md states outright that "there is
// therefore no operation that sets muting: `mute` is reached the way a player
// reaches it, through its binding in specs/controls.md, and the snapshot reports
// the result".
//
// THE KEY IS HELD FOR ONE FRAME rather than tapped between frames. The engine
// reports an action's press edge and its held value, and one frame with the key
// down arms the edge AND raises the value for exactly one frame, so a build
// reading either flips the bit exactly once per press here.
//
// TWO PRESSES, NOT ONE, so every wrong model reads a different pair of bits and
// a failure names which one the build implemented: a key that did nothing leaves
// the opening bit standing through both readings, a key wired to SET the bit
// rather than toggle it flips once and then holds, and only a real toggle turns
// it over and back.
//
// WHAT THIS DOES NOT DECIDE. That a muted game plays no sound, which is
// audio/mute-silences' — the bit and the silence are two claims, and a build
// that flips the bit without silencing the bus must grade differently from one
// that never flips it at all.
//
// THE WORLD IS EMPTY AND QUIET. `startPlaying` clears every node, worm, foe and
// bolt and shuts the three world gates, so nothing on the board raises a cue or
// moves the screen while the two presses are read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds the `mute` action to. */
const KEY = "KeyM";

/** Frames the key is down: one, which is one press. */
const PRESS_TICKS = 1;

/**
 * Frames between a press and the reading it settles.
 *
 * A beat, not a measurement: `holdFor` runs the frame that delivers the key, and
 * these follow it. specs/instrumentation.md has `muted` be the game's copy of
 * the runtime's bit, "refreshed in every update", so a build that mirrors the
 * engine's bit at the top of the next frame reads the same as one that mirrors
 * it in the frame the key arrived on.
 */
const BEAT_TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the muted bit on KeyM, and flips it back", async () => {
  startPlaying(h);

  const opening = h.snapshot();

  await holdFor(h, KEY, PRESS_TICKS);
  await h.advance(BEAT_TICKS);
  const once = h.snapshot();

  await holdFor(h, KEY, PRESS_TICKS);
  await h.advance(BEAT_TICKS);
  const twice = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture of
  // the board the toggle was driven from.
  captureStill(h, "muted");

  assertEqual(
    once.muted,
    !opening.muted,
    `the muted bit after one press of ${KEY}, which toggles sound ` +
      `(specs/controls.md); it stood at ${String(opening.muted)} before`,
  );
  assertEqual(
    twice.muted,
    opening.muted,
    `the muted bit after a second press of ${KEY}, which toggles it back`,
  );
});
