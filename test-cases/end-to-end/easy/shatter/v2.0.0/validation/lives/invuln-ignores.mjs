// Automated validation for the Lives item `invuln-ignores`: during the post-respawn
// invulnerability window the ship ignores all collisions. A long invulnerability is set
// and a rock is placed on the ship; after the real sim runs, no life is lost and the game
// is still in play.
//
// Posing the invulnerable ship with a rock sitting on it is instant (`arrange`); running the
// sim long enough for a lethal hit to have happened — and seeing it not happen — is the
// behavior (`act`). 1.0 s x 120 Hz = 120 ticks.
//
// `setInvuln` takes SECONDS: it is the unit the game states the invulnerability window in, so
// the 5 stays as it was. Only the DURATION advanced is a tick count.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The state after a second of the rock resting on an invulnerable ship.
  let snap;

  return {
    id: "lives.invuln-ignores",

    async arrange(api) {
      await newGame(api);
      await api.call("setLives", 3);
      await api.call("setInvuln", 5); // seconds — a wide open invulnerability window
      await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 }); // sitting on the ship
    },

    async act(api) {
      await api.advance(120);
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "an invulnerable ship loses no life to a collision",
        snap.lives,
        3,
      );
      check.expectEq(
        "the game keeps playing (the hit was ignored)",
        snap.screen,
        "playing",
      );
    },
  };
}
