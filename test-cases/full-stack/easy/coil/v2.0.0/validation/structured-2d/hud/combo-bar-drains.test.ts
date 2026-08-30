/*
 * Coil validator: `hud.combo-bar-drains`. PLACEHOLDER.
 *
 * The combo bar drains with the window.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * More of the HUD band is painted at the same multiplier with a full
 * COMBO_WINDOW than with the window nearly spent, so the bar drains as the
 * window does.
 *
 * HOW:
 * render one frame at a raised multiplier with a full window and one with a
 * nearly spent window, and compare how much of the HUD band each painted.
 *
 * MEDIA IT MUST CAPTURE: full (image), spent (image).
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

test("hud.combo-bar-drains", () => {
  throw new Error("validator not implemented: hud/combo-bar-drains.test.ts");
});
