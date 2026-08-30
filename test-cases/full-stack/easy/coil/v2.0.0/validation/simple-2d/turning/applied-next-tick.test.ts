/*
 * Coil validator: `turning.applied-next-tick`. PLACEHOLDER.
 *
 * A turn takes effect on the next tick.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A steering request moves nothing at the call: the chain and dir are
 * unchanged until a tick resolves, and the head then advances the new way.
 *
 * HOW:
 * request a perpendicular turn, read the snapshot before any tick, then run
 * one tick and read it again.
 *
 * MEDIA IT MUST CAPTURE: turn (replay).
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

test("turning.applied-next-tick", () => {
  throw new Error(
    "validator not implemented: turning/applied-next-tick.test.ts",
  );
});
