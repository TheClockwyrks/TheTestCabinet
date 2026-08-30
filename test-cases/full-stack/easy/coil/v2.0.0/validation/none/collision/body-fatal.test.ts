/*
 * Coil validator: `collision.body-fatal`. PLACEHOLDER.
 *
 * Entering a body segment is fatal.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The head advancing into a solid body cell, one that is neither the head nor
 * a tail vacating this tick, ends the round immediately as a death.
 *
 * HOW:
 * pose a coiled chain whose next head cell is one of its own middle segments,
 * run one tick, and read the screen back.
 *
 * MEDIA IT MUST CAPTURE: self (replay).
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

test("collision.body-fatal", () => {
  throw new Error("validator not implemented: collision/body-fatal.test.ts");
});
