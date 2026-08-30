/*
 * Coil validator: `movement.one-cell-per-tick`. PLACEHOLDER.
 *
 * One cell per tick.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A tick advances the head exactly one cell in the direction dir names, and no
 * further.
 *
 * HOW:
 * pose a chain with clear board ahead of it, run one tick, and compare the new
 * head cell against the old one plus the direction vector.
 *
 * MEDIA IT MUST CAPTURE: move (replay).
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

test("movement.one-cell-per-tick", () => {
  throw new Error(
    "validator not implemented: movement/one-cell-per-tick.test.ts",
  );
});
