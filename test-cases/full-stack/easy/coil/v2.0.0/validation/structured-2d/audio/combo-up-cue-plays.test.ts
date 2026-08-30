/*
 * Coil validator: `audio.combo-up-cue-plays`. PLACEHOLDER.
 *
 * The combo cue plays on the rise.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The combo-up cue is played exactly once on the tick the multiplier rises,
 * and on no tick before it.
 *
 * HOW:
 * watch the cues asked for while driving a real eat inside an open window and
 * confirm combo-up arrived once, on that tick.
 *
 * MEDIA IT MUST CAPTURE: combo (replay).
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

test("audio.combo-up-cue-plays", () => {
  throw new Error(
    "validator not implemented: audio/combo-up-cue-plays.test.ts",
  );
});
