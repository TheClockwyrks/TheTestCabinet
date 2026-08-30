/*
 * Coil validator: `growth.length-constant-on-normal-tick`. PLACEHOLDER.
 *
 * A tick that eats nothing leaves the length unchanged.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On a tick eating no pellet the chain's length is unchanged: one cell joins
 * at the head and the tail cell is dropped.
 *
 * HOW:
 * clear the pellet, run several ticks over open board, and confirm the chain's
 * length never moves and the old tail cell is released each tick.
 *
 * MEDIA IT MUST CAPTURE: steady (replay).
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

test("growth.length-constant-on-normal-tick", () => {
  throw new Error(
    "validator not implemented: growth/length-constant-on-normal-tick.test.ts",
  );
});
