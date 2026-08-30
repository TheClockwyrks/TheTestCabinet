/*
 * Coil validator: `screens.cleared-copy`. PLACEHOLDER.
 *
 * The cleared screen draws its heading.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The cleared frame draws CLEARED_TEXT (BOARD CLEARED) in place of
 * GAMEOVER_TEXT, with the same score, best and menu beneath it.
 *
 * HOW:
 * drive the board-cleared ending, read the frame's text draws, and capture the
 * screen.
 *
 * MEDIA IT MUST CAPTURE: cleared (image).
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

test("screens.cleared-copy", () => {
  throw new Error("validator not implemented: screens/cleared-copy.test.ts");
});
