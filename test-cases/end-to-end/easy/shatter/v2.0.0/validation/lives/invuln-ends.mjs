// Automated validation for the Lives item `invuln-ends`: once the invulnerability window
// is over, collisions are lethal again. Invulnerability is cleared and a rock is placed on
// the ship; the real collision code must cost a life.
//
// Posing the vulnerable ship with a rock sitting on it is instant (`arrange`); letting the real
// collision resolve is the behavior (`act`), so the clip shows the ship actually being lost.
//
// The sweep runs to 1 s x 120 Hz = 120 ticks and polls a single tick so the life is read the
// instant it is lost.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

export default function item() {
  // Whether the collision landed within the window, and the state it left behind.
  let outcome;

  return {
    id: "lives.invuln-ends",

    async arrange(api) {
      await newGame(api);
      await api.call("setLives", 3);
      await api.call("setInvuln", 0); // no invulnerability — collisions are lethal
      await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 }); // sitting on the ship
    },

    async act(api) {
      outcome = await api.until((s) => s.lives < 3, { max: 120, poll: TICK });
    },

    async assert(api, check) {
      check.expectOk(
        "with invulnerability over, the collision is lethal",
        outcome.hit,
      );
      check.expectEq(
        "the ship is destroyed and a life is lost",
        outcome.snap.lives,
        2,
      );
    },
  };
}
