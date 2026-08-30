/*
 * Coil validator: `audio.eat-cue-plays`. PLACEHOLDER.
 *
 * The eat cue plays on the eat.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The eat cue is played exactly once on the tick a pellet is eaten, and on no
 * tick before it.
 *
 * HOW:
 * watch the cues asked for while driving a real eat and confirm eat arrived
 * once, on that tick.
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

test("audio.eat-cue-plays", () => {
  throw new Error("validator not implemented: audio/eat-cue-plays.test.ts");
});
