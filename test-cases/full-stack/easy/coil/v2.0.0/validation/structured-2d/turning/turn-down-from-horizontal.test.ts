/*
 * Coil validator: `turning.turn-down-from-horizontal`. PLACEHOLDER.
 *
 * Turning down while travelling horizontally.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Travelling right, a down request sets dir to down on the next tick and the
 * head advances one cell down.
 *
 * HOW:
 * pose the chain facing right with clear board below it, request down, run one
 * tick, and read dir and the head cell.
 *
 * MEDIA IT MUST CAPTURE: down (replay).
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

test("turning.turn-down-from-horizontal", () => {
  throw new Error(
    "validator not implemented: turning/turn-down-from-horizontal.test.ts",
  );
});
