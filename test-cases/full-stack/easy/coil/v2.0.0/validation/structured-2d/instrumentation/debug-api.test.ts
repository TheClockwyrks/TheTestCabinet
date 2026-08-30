/*
 * Coil validator: `instrumentation.debug-api`. PLACEHOLDER.
 *
 * Debug and automation surface present.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Every operation specs/instrumentation.md names for this mode is present on
 * the debug surface, each poses or reads the running game, and snapshot
 * reports the full documented shape with live values.
 *
 * HOW:
 * reach the surface, confirm every named operation is a function, drive each
 * one against a real game, and read a snapshot back carrying every documented
 * field.
 *
 * MEDIA IT MUST CAPTURE: state (image).
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

test("instrumentation.debug-api", () => {
  throw new Error(
    "validator not implemented: instrumentation/debug-api.test.ts",
  );
});
