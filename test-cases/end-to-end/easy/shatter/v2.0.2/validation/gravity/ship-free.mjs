// Automated validation for the Gravity item `ship-free`: the ship is a powered craft
// and is never pulled by the star. The ship is posed at rest well off the star with no
// keys held; after the real sim steps it must not have moved at all — a body subject to
// gravity would drift toward the star.
//
// Posing the ship is the precondition (`arrange`); the full second of the star failing to move
// it is the behavior (`act`). The clip is deliberately a still-looking one: a ship that does
// not budge is precisely what is being claimed. 1.0 s x 120 Hz = 120 ticks.

import { newGame, poseShip, distToStar, speedOf } from "../_helpers.mjs";

export default function item() {
  // The ship's starting distance from the star, and its state a second later.
  let dBefore;
  let after;

  return {
    id: "gravity.ship-free",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
      dBefore = distToStar((await api.snapshot()).ship);
    },

    async act(api) {
      await api.advance(120); // a full second under the star's pull, no input
      after = (await api.snapshot()).ship;
    },

    async assert(api, check) {
      check.expectClose(
        "the ship at rest is not pulled — it stays put in x",
        after.x,
        300,
        0.001,
      );
      check.expectClose(
        "the ship at rest is not pulled — it stays put in y",
        after.y,
        300,
        0.001,
      );
      check.expectClose(
        "the ship gains no velocity from gravity",
        speedOf(after),
        0,
        0.001,
      );
      check.expectClose(
        "its distance from the star is unchanged",
        distToStar(after),
        dBefore,
        0.001,
      );
    },
  };
}
