// Floe — screens/gameover-play-again: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `screens.gameover-play-again` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   PLAY AGAIN on the game-over screen opens a fresh run
//
//   On the game-over screen with PLAY AGAIN highlighted, confirming opens
//   playing at level 1 with three lives, score 0 and five open bays.
//
// Its declared media: image `after`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("screens/gameover-play-again has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});
