/*
 * Coil validator: `hud.combo-hidden-at-one`. PLACEHOLDER.
 *
 * The combo readout is empty at one.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * At an M of 1 the HUD draws no multiplier readout and no combo bar, so the
 * combo area is empty.
 *
 * HOW:
 * pose M at 1 with a closed window, render a live frame, and confirm no
 * multiplier text and no bar were drawn in the combo area.
 *
 * MEDIA IT MUST CAPTURE: empty (image).
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

test("hud.combo-hidden-at-one", () => {
  throw new Error("validator not implemented: hud/combo-hidden-at-one.test.ts");
});
