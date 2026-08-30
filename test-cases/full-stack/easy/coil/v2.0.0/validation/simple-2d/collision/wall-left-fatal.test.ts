/*
 * Coil validator: `collision.wall-left-fatal`. PLACEHOLDER.
 *
 * The left wall is fatal.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The head advancing into column 0 ends the round immediately as a death.
 *
 * HOW:
 * pose the head on column 1 facing left with the pellet cleared, run one tick,
 * and read the screen back.
 *
 * MEDIA IT MUST CAPTURE: left (replay).
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

test("collision.wall-left-fatal", () => {
  throw new Error(
    "validator not implemented: collision/wall-left-fatal.test.ts",
  );
});
