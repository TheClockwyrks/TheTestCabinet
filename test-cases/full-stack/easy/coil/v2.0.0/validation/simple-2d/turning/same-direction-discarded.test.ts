/*
 * Coil validator: `turning.same-direction-discarded`. PLACEHOLDER.
 *
 * A request repeating the heading is discarded.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A request naming the direction the snake already travels in is discarded at
 * step 1: dir is unchanged, the head advances the way it was going, and the
 * request is gone from turns.
 *
 * HOW:
 * pose the chain facing right, request right, run one tick, and confirm dir,
 * the head's travel and an emptied buffer.
 *
 * MEDIA IT MUST CAPTURE: repeat (replay).
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

test("turning.same-direction-discarded", () => {
  throw new Error(
    "validator not implemented: turning/same-direction-discarded.test.ts",
  );
});
