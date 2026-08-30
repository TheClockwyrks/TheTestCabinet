/*
 * Coil validator: `growth.respawn-varies`. PLACEHOLDER.
 *
 * The respawn cell is drawn, not fixed.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Across a long run of eats the placed pellets occupy more than one distinct
 * cell, so the next pellet is drawn from the valid set rather than always
 * placed on the same cell.
 *
 * HOW:
 * drive a long run of eats and count the distinct cells the pellets landed on.
 *
 * MEDIA IT MUST CAPTURE: varied (replay).
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

test("growth.respawn-varies", () => {
  throw new Error("validator not implemented: growth/respawn-varies.test.ts");
});
