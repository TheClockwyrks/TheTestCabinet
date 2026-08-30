/*
 * Coil validator: `movement.subdivision-invariant`. PLACEHOLDER.
 *
 * The tick is driven by elapsed time, not by frames.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * One second of game time delivered as sixty updates resolves the same eight
 * ticks, and leaves the same head cell, as one second delivered in a single
 * update.
 *
 * HOW:
 * run the same posed scenario twice, once in a single update and once in
 * sixty, and compare ticks and the head cell.
 *
 * MEDIA IT MUST CAPTURE: divided (replay).
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

test("movement.subdivision-invariant", () => {
  throw new Error(
    "validator not implemented: movement/subdivision-invariant.test.ts",
  );
});
