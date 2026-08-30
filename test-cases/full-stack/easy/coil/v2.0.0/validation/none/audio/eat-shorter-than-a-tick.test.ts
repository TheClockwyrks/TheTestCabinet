/*
 * Coil validator: `audio.eat-shorter-than-a-tick`. PLACEHOLDER.
 *
 * The eat cue is shorter than a tick.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * assets/audio/eat.wav is shorter than TICK_SECONDS (0.125 s), so eight of
 * them in a second stay distinct rather than smearing into one tone.
 *
 * HOW:
 * read the WAV's header and compute its duration from its sample count and
 * rate.
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

test("audio.eat-shorter-than-a-tick", () => {
  throw new Error(
    "validator not implemented: audio/eat-shorter-than-a-tick.test.ts",
  );
});
