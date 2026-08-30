/*
 * Coil validator: `audio.eat-file-produced`. PLACEHOLDER.
 *
 * The eat cue ships a produced sound.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * assets/audio/eat.wav exists, decodes as a WAV of non-zero length, and
 * carries audible signal rather than silence.
 *
 * HOW:
 * read the WAV off the built workspace, parse its header, and measure its peak
 * amplitude.
 *
 * MEDIA IT MUST CAPTURE: eat (replay).
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

test("audio.eat-file-produced", () => {
  throw new Error("validator not implemented: audio/eat-file-produced.test.ts");
});
