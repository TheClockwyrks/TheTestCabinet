/*
 * Coil validator: `turning.one-turn-per-tick`. PLACEHOLDER.
 *
 * At most one turn resolves per tick.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Travelling right, a down request followed by a left request inside one tick
 * turns the snake down on the next tick and left on the tick after, so the
 * chain never folds onto itself.
 *
 * HOW:
 * pose the chain facing right, buffer down and then left, and read dir after
 * each of the next two ticks.
 *
 * MEDIA IT MUST CAPTURE: double (replay).
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

test("turning.one-turn-per-tick", () => {
  throw new Error(
    "validator not implemented: turning/one-turn-per-tick.test.ts",
  );
});
