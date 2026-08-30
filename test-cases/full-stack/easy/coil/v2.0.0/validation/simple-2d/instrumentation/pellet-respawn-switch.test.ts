/*
 * Coil validator: `instrumentation.pellet-respawn-switch`. PLACEHOLDER.
 *
 * The respawn switch leaves an eaten pellet unreplaced.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * With setPelletRespawn(false) a pellet eaten by the head leaves pellet at
 * null rather than placing the next one, and the round carries on.
 *
 * HOW:
 * turn respawn off, place a pellet ahead of the head, eat it, and confirm the
 * score rose while pellet is null.
 *
 * MEDIA IT MUST CAPTURE: unreplaced (replay).
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

test("instrumentation.pellet-respawn-switch", () => {
  throw new Error(
    "validator not implemented: instrumentation/pellet-respawn-switch.test.ts",
  );
});
