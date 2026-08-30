/*
 * Coil validator: `movement.no-speedup-when-long`. PLACEHOLDER.
 *
 * Growth never speeds the tick up.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A snake of thirty cells advances exactly eight cells in one second of game
 * time, the same rate a three-cell snake does.
 *
 * HOW:
 * pose a thirty-cell chain with a clear run ahead of it, advance one second of
 * game time, and read ticks and the head's travel.
 *
 * MEDIA IT MUST CAPTURE: speed (replay).
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

test("movement.no-speedup-when-long", () => {
  throw new Error(
    "validator not implemented: movement/no-speedup-when-long.test.ts",
  );
});
