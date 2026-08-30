/*
 * Coil validator: `audio.eat-and-combo-on-one-tick`. PLACEHOLDER.
 *
 * An eat that raises the combo plays both cues.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A tick that both eats a pellet and raises the multiplier plays eat once and
 * combo-up once.
 *
 * HOW:
 * pose an open window at a raised multiplier, drive one eat, and count each
 * cue asked for on that tick.
 *
 * MEDIA IT MUST CAPTURE: both (replay).
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

test("audio.eat-and-combo-on-one-tick", () => {
  throw new Error(
    "validator not implemented: audio/eat-and-combo-on-one-tick.test.ts",
  );
});
