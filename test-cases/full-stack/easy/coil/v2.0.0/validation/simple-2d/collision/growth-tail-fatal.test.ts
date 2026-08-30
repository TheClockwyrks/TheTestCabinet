/*
 * Coil validator: `collision.growth-tail-fatal`. PLACEHOLDER.
 *
 * Entering the tail on a growth tick is fatal.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On a tick that eats a pellet the tail does not retract, so the tail cell is
 * solid and the head entering it ends the round as a death.
 *
 * HOW:
 * pose a chain whose next head cell is its own tail and place the pellet on
 * that same cell, run one tick, and read the screen back.
 *
 * MEDIA IT MUST CAPTURE: growthtail (replay).
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

test("collision.growth-tail-fatal", () => {
  throw new Error(
    "validator not implemented: collision/growth-tail-fatal.test.ts",
  );
});
