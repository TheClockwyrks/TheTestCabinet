/*
 * Coil validator: `screens.gameover-copy`. PLACEHOLDER.
 *
 * The game-over screen draws its copy.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The gameover frame draws GAMEOVER_TEXT (GAME OVER), SCORE_LABEL with the
 * final score, BEST_LABEL with the session best, and every item of OVER_ITEMS.
 *
 * HOW:
 * drive a death from a known score, read the frame's text draws, and capture
 * the screen.
 *
 * MEDIA IT MUST CAPTURE: gameover (image).
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

test("screens.gameover-copy", () => {
  throw new Error("validator not implemented: screens/gameover-copy.test.ts");
});
