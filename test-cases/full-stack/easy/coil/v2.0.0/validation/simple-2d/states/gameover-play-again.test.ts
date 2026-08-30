/*
 * Coil validator: `states.gameover-play-again`. PLACEHOLDER.
 *
 * Playing again from game over opens a fresh round.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * confirm on PLAY AGAIN sets screen to playing with the starting chain and a
 * score of 0.
 *
 * HOW:
 * reach the game-over screen, confirm PLAY AGAIN, and read the chain and the
 * score.
 *
 * MEDIA IT MUST CAPTURE: again (image).
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

test("states.gameover-play-again", () => {
  throw new Error(
    "validator not implemented: states/gameover-play-again.test.ts",
  );
});
