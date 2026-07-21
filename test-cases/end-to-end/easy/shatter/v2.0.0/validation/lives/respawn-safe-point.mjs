// Automated validation for the Lives item `respawn-safe-point`: losing a ship (with lives
// left) respawns the next at the safe point below the star, facing up, with a brief
// invulnerability. Invulnerability is cleared and a rock is placed on the ship; the real
// collision code kills it, and the respawned ship's pose is read back.
//
// Posing the vulnerable ship with a rock sitting on it is instant (`arrange`); the death and
// the respawn that follows are the behavior (`act`), so the clip shows the ship lost and
// reappearing at the safe point.
//
// The sweep runs to 1 s x 120 Hz = 120 ticks and polls a single tick so the respawn is read the
// instant it happens, while the fresh invulnerability is still counting down.

import {
  newGame,
  poseShip,
  SAFE_X,
  SAFE_Y,
  FACE_UP,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  // The state the instant the ship was lost and replaced, read by `assert`.
  let snap;

  return {
    id: "lives.respawn-safe-point",

    async arrange(api) {
      await newGame(api);
      await api.call("setLives", 3);
      await api.call("setInvuln", 0);
      await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 }); // sitting on the ship
    },

    async act(api) {
      ({ snap } = await api.until((s) => s.lives < 3, {
        max: 120,
        poll: TICK,
      }));
    },

    async assert(api, check) {
      check.expectEq(
        "losing a ship drops a life (respawn, not game over)",
        snap.lives,
        2,
      );
      check.expectEq(
        "the game keeps playing after a respawn",
        snap.screen,
        "playing",
      );
      check.expectClose(
        "the ship respawns at the safe point (x)",
        snap.ship.x,
        SAFE_X,
        0.5,
      );
      check.expectClose(
        "the ship respawns at the safe point (y, below the star)",
        snap.ship.y,
        SAFE_Y,
        0.5,
      );
      check.expectClose(
        "the respawned ship faces up",
        snap.ship.angle,
        FACE_UP,
        1e-6,
      );
      check.expectGt(
        "the respawn grants a brief invulnerability",
        snap.invuln,
        0,
      );
    },
  };
}
