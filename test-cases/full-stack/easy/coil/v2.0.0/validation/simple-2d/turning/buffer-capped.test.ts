/*
 * Coil validator: `turning.buffer-capped`. PLACEHOLDER.
 *
 * The turn buffer holds at most two requests.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * turns never holds more than TURN_QUEUE_MAX (2) requests: a third request
 * arriving before a tick resolves is discarded and never turns the snake.
 *
 * HOW:
 * buffer three distinct requests inside one tick, read the buffer's length,
 * then run ticks and confirm the third one never took effect.
 *
 * MEDIA IT MUST CAPTURE: full (replay).
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

test("turning.buffer-capped", () => {
  throw new Error("validator not implemented: turning/buffer-capped.test.ts");
});
