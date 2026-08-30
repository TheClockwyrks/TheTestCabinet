/*
 * Coil validator: `controls.arrow-up-steers`. PLACEHOLDER.
 *
 * ArrowUp steers up.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * ArrowUp on the playing screen requests a turn to up, which the next tick
 * applies from a horizontal heading.
 *
 * HOW:
 * pose the chain facing right, dispatch ArrowUp, run one tick, and read dir.
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

test("controls.arrow-up-steers", () => {
  throw new Error(
    "validator not implemented: controls/arrow-up-steers.test.ts",
  );
});
