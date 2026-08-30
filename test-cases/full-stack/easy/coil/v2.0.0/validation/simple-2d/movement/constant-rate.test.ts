/*
 * Coil validator: `movement.constant-rate`. PLACEHOLDER.
 *
 * Eight ticks in a second of game time.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * One second of game time resolves exactly eight ticks, so ticks rises by
 * eight and the head travels eight cells.
 *
 * HOW:
 * pose a clear run ahead of the head, advance one second of game time on the
 * validator's own clock, and read ticks and the head cell.
 *
 * MEDIA IT MUST CAPTURE: rate (replay).
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

test("movement.constant-rate", () => {
  throw new Error("validator not implemented: movement/constant-rate.test.ts");
});
