/*
 * Coil validator: `hud.mode-label-classic`. PLACEHOLDER.
 *
 * The HUD names the mode.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A frame of the live round draws MODE_LABEL (CLASSIC) as the mode readout in
 * the HUD band.
 *
 * HOW:
 * render a live frame and find the mode readout's text draw.
 *
 * MEDIA IT MUST CAPTURE: mode (image).
 *
 * It is the `base` variant's own point, decided only when that variant runs.
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

test("hud.mode-label-classic", () => {
  throw new Error("validator not implemented: hud/mode-label-classic.test.ts");
});
