/*
 * Coil validator: `growth.grows-by-one`. PLACEHOLDER.
 *
 * Eating grows the snake by exactly one cell.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The tick that eats a pellet keeps the tail, so the chain is exactly one cell
 * longer than it was and the tail cell is unchanged.
 *
 * HOW:
 * place a pellet one cell ahead of the head, run the tick that eats it, and
 * compare the chain's length and its tail cell against the tick before.
 *
 * MEDIA IT MUST CAPTURE: grow (replay).
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

test("growth.grows-by-one", () => {
  throw new Error("validator not implemented: growth/grows-by-one.test.ts");
});
