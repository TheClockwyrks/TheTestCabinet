/*
 * Coil validator: `turning.turn-up-from-horizontal`. PLACEHOLDER.
 *
 * Turning up while travelling horizontally.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Travelling right, an up request sets dir to up on the next tick and the head
 * advances one cell up.
 *
 * HOW:
 * pose the chain facing right with clear board above it, request up, run one
 * tick, and read dir and the head cell.
 *
 * MEDIA IT MUST CAPTURE: up (replay).
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

test("turning.turn-up-from-horizontal", () => {
  throw new Error(
    "validator not implemented: turning/turn-up-from-horizontal.test.ts",
  );
});
