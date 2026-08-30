/*
 * Coil validator: `instrumentation.travel-switch`. PLACEHOLDER.
 *
 * The travel switch holds the snake still.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * With setSnakeTravel(false) the chain holds the cells it stands on over many
 * ticks, so nothing collides and nothing is eaten, while a buffered turn is
 * still taken and dir still changes.
 *
 * HOW:
 * turn travel off, pose the head one cell from a wall, run far more ticks than
 * it would take to reach it, and confirm the chain and the screen are
 * unchanged while a requested turn still lands in dir.
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

test("instrumentation.travel-switch", () => {
  throw new Error(
    "validator not implemented: instrumentation/travel-switch.test.ts",
  );
});
