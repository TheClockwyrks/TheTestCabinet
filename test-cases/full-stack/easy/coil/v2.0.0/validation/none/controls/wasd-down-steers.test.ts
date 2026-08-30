/*
 * Coil validator: `controls.wasd-down-steers`. PLACEHOLDER.
 *
 * KeyS steers down.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * KeyS does exactly what ArrowDown does on the playing screen.
 *
 * HOW:
 * pose the chain facing right, dispatch KeyS, run one tick, and read dir.
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

test("controls.wasd-down-steers", () => {
  throw new Error(
    "validator not implemented: controls/wasd-down-steers.test.ts",
  );
});
