/*
 * Coil validator: `controls.arrow-left-steers`. PLACEHOLDER.
 *
 * ArrowLeft steers left.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * ArrowLeft on the playing screen requests a turn to left, which the next tick
 * applies from a vertical heading.
 *
 * HOW:
 * pose the chain facing up, dispatch ArrowLeft, run one tick, and read dir.
 *
 * MEDIA IT MUST CAPTURE: left (replay).
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

test("controls.arrow-left-steers", () => {
  throw new Error(
    "validator not implemented: controls/arrow-left-steers.test.ts",
  );
});
