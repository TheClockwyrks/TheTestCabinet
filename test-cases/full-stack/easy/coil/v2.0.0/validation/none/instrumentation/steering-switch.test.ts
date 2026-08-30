/*
 * Coil validator: `instrumentation.steering-switch`. PLACEHOLDER.
 *
 * The steering switch holds the snake's heading.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * With setSnakeSteering(false) the turn buffer stays empty and dir holds its
 * value however many steering requests arrive, while the head still advances
 * each tick along dir; turning it back on takes requests again.
 *
 * HOW:
 * turn steering off, request every direction over several ticks, and confirm
 * turns stays empty and dir never changes while the head keeps advancing.
 *
 * MEDIA IT MUST CAPTURE: held (replay).
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

test("instrumentation.steering-switch", () => {
  throw new Error(
    "validator not implemented: instrumentation/steering-switch.test.ts",
  );
});
