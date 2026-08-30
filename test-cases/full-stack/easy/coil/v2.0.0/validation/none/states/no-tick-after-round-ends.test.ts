/*
 * Coil validator: `states.no-tick-after-round-ends`. PLACEHOLDER.
 *
 * Nothing advances once the round has ended.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On the game-over screen no tick resolves however much game time passes:
 * ticks and the chain are unchanged.
 *
 * HOW:
 * drive a death, advance several seconds of game time, and read ticks and the
 * chain.
 *
 * MEDIA IT MUST CAPTURE: still (replay).
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

test("states.no-tick-after-round-ends", () => {
  throw new Error(
    "validator not implemented: states/no-tick-after-round-ends.test.ts",
  );
});
