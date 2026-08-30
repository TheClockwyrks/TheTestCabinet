/*
 * Coil validator: `growth.first-pellet-off-start-chain`. PLACEHOLDER.
 *
 * The first pellet of a round is valid.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The first pellet of a fresh round sits on an interior cell holding none of
 * the three starting cells of specs/board.md, so it is placed after the snake
 * is laid.
 *
 * HOW:
 * open a fresh round repeatedly across several seeds and test the first
 * pellet's cell against the interior bounds and the starting chain.
 *
 * MEDIA IT MUST CAPTURE: first (image).
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

test("growth.first-pellet-off-start-chain", () => {
  throw new Error(
    "validator not implemented: growth/first-pellet-off-start-chain.test.ts",
  );
});
