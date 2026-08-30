/*
 * Coil validator: `hud.mute-indicator-changes`. PLACEHOLDER.
 *
 * The mute indicator tells the two states apart.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The HUD drawn while muted differs from the HUD drawn while unmuted on the
 * same board, so a player reads the sound state off the screen.
 *
 * HOW:
 * render the same posed board unmuted and muted and compare what the HUD band
 * drew in each.
 *
 * MEDIA IT MUST CAPTURE: unmuted (image), muted (image).
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

test("hud.mute-indicator-changes", () => {
  throw new Error(
    "validator not implemented: hud/mute-indicator-changes.test.ts",
  );
});
