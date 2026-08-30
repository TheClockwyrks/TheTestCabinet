/*
 * Coil validator: `instrumentation.pellet-sequence-deterministic`. PLACEHOLDER.
 *
 * The pellet sequence is seeded and reproducible.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Two runs from reset({ seed }) with the same seed and the same sequence of
 * calls place their pellets on exactly the same cells in the same order.
 *
 * HOW:
 * seed a game, drive a run of eats and record the cell each pellet landed on,
 * then seed a second game the same way and compare the two sequences.
 *
 * MEDIA IT MUST CAPTURE: seeded (replay).
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

test("instrumentation.pellet-sequence-deterministic", () => {
  throw new Error(
    "validator not implemented: instrumentation/pellet-sequence-deterministic.test.ts",
  );
});
