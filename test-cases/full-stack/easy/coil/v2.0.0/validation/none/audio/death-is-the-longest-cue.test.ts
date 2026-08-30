/*
 * Coil validator: `audio.death-is-the-longest-cue`. PLACEHOLDER.
 *
 * The death cue is the heaviest of the three.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * assets/audio/death.wav is longer than both eat.wav and combo-up.wav, so the
 * end of a round is the one heavy sound in the game.
 *
 * HOW:
 * read the three WAV headers and compare their durations.
 *
 * MEDIA IT MUST CAPTURE: death (replay).
 *
 * It is a COMMON point, decided for every variant.
 *
 * The manifest declares this path, so the file must exist for the version to
 * resolve. It throws rather than passing, so a point whose suite has not been
 * written yet can never be mistaken for a point that passed. Replace the body:
 * pose the scenario through the debug surface alone, clearing everything the
 * claim is not about, run the real systems for a bounded span, assert the one
 * claim above through the shared assertion helpers, and capture the declared
 * media around the drive rather than around the arrangement.
 */
import { test } from "vitest";

test("audio.death-is-the-longest-cue", () => {
  throw new Error(
    "validator not implemented: audio/death-is-the-longest-cue.test.ts",
  );
});
