/*
 * Coil validator: `states.no-tick-on-title`. PLACEHOLDER.
 *
 * Nothing advances on the title screen.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On the title screen no tick resolves however much game time passes: ticks
 * and simTime are unchanged and the chain has not moved.
 *
 * HOW:
 * sit on the title screen, advance several seconds of game time, and read
 * ticks, simTime and the chain.
 *
 * MEDIA IT MUST CAPTURE: still (replay).
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

test("states.no-tick-on-title", () => {
  throw new Error("validator not implemented: states/no-tick-on-title.test.ts");
});
