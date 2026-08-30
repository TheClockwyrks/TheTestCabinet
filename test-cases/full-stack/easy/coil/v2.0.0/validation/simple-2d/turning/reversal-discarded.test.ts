/*
 * Coil validator: `turning.reversal-discarded`. PLACEHOLDER.
 *
 * A reversal into the neck is discarded.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A request naming the opposite of the current direction is discarded at step
 * 1: dir is unchanged and the head advances the way it was going, so the snake
 * never reverses into its own neck.
 *
 * HOW:
 * pose the chain facing right, request left, run one tick, and confirm dir and
 * the head's travel are unchanged.
 *
 * MEDIA IT MUST CAPTURE: reversal (replay).
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

test("turning.reversal-discarded", () => {
  throw new Error(
    "validator not implemented: turning/reversal-discarded.test.ts",
  );
});
