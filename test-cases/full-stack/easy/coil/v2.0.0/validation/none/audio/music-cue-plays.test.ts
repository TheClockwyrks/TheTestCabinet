/*
 * Coil validator: `audio.music-cue-plays`. PLACEHOLDER.
 *
 * The music bed plays under a round.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The music cue is played when a round begins, and on no frame before the
 * round begins.
 *
 * HOW:
 * watch the cues asked for from the title screen through the start of a round
 * and confirm music arrived at the start and not before.
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

test("audio.music-cue-plays", () => {
  throw new Error("validator not implemented: audio/music-cue-plays.test.ts");
});
