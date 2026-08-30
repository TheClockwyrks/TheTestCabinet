/*
 * Coil validator: `controls.p-pauses`. PLACEHOLDER.
 *
 * KeyP pauses a live round.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * KeyP on the playing screen sets screen to paused.
 *
 * HOW:
 * start a round, dispatch KeyP, and read the screen.
 *
 * MEDIA IT MUST CAPTURE: paused (image).
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

test("controls.p-pauses", () => {
  throw new Error("validator not implemented: controls/p-pauses.test.ts");
});
