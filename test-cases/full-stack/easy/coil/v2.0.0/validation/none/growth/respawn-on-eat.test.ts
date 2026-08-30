/*
 * Coil validator: `growth.respawn-on-eat`. PLACEHOLDER.
 *
 * An eaten pellet is replaced at once.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The tick that eats a pellet places the next one on the same tick, so exactly
 * one live pellet is on the board when the tick has resolved.
 *
 * HOW:
 * place a pellet ahead of the head, run the tick that eats it, and read the
 * snapshot's pellet back.
 *
 * MEDIA IT MUST CAPTURE: respawn (replay).
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

test("growth.respawn-on-eat", () => {
  throw new Error("validator not implemented: growth/respawn-on-eat.test.ts");
});
