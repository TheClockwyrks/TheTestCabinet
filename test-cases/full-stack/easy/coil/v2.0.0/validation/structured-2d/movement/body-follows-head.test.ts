/*
 * Coil validator: `movement.body-follows-head`. PLACEHOLDER.
 *
 * Each segment takes the cell ahead of it.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * After a tick that eats nothing, every body segment holds the cell the
 * segment ahead of it held before the tick, so the chain stays contiguous with
 * no gap and no branch.
 *
 * HOW:
 * pose a chain several cells long, run one tick, and compare the new chain
 * against the old one shifted by a cell.
 *
 * MEDIA IT MUST CAPTURE: follow (replay).
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

test("movement.body-follows-head", () => {
  throw new Error(
    "validator not implemented: movement/body-follows-head.test.ts",
  );
});
