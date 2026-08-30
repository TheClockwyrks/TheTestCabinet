/*
 * Coil validator: `audio.music-file-produced`. PLACEHOLDER.
 *
 * The music bed ships a produced track.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * assets/audio/music.wav exists, decodes as a WAV of non-zero length, and
 * carries audible signal rather than silence.
 *
 * HOW:
 * read the WAV off the built workspace, parse its header, and measure its peak
 * amplitude.
 *
 * MEDIA IT MUST CAPTURE: music (replay).
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

test("audio.music-file-produced", () => {
  throw new Error(
    "validator not implemented: audio/music-file-produced.test.ts",
  );
});
