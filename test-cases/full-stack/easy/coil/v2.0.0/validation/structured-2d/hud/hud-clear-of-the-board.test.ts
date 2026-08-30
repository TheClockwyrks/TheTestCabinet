/*
 * Coil validator: `hud.hud-clear-of-the-board`. PLACEHOLDER.
 *
 * The HUD stays clear of the play area.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On the playing screen every HUD readout is drawn inside the band above the
 * board, y in [0, BOARD_Y), so nothing the HUD draws crosses the play area.
 *
 * HOW:
 * render a live frame with every readout showing and confirm each HUD draw
 * sits above BOARD_Y.
 *
 * MEDIA IT MUST CAPTURE: band (image).
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

test("hud.hud-clear-of-the-board", () => {
  throw new Error(
    "validator not implemented: hud/hud-clear-of-the-board.test.ts",
  );
});
