/*
 * Coil validator: `states.opens-on-title`. PLACEHOLDER.
 *
 * The game opens on the title screen.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A freshly loaded game is on the title screen with menuIndex at 0.
 *
 * HOW:
 * load the build and read the screen and the highlight before any input.
 *
 * MEDIA IT MUST CAPTURE: title (image).
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

test("states.opens-on-title", () => {
  throw new Error("validator not implemented: states/opens-on-title.test.ts");
});
