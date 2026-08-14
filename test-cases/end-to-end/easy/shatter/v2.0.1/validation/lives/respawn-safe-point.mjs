// Automated validation for the Lives item `respawn-safe-point`: losing a ship (with lives
// left) respawns the next at the safe point below the star, facing up, with a brief
// invulnerability. Invulnerability is cleared and a rock is placed on the ship; the real
// collision code kills it, and the respawned ship's pose is read back.
//
// Posing the vulnerable ship with a rock sitting on it is instant (`arrange`); the death and
// the respawn that follows are the behavior (`act`), so the clip shows the ship lost and
// reappearing at the safe point, blinking out its grace window.
//
// The wait is `actUntilShipLost`, which waits for the life to come off the count and THEN for
// a ship to be out somewhere other than where this one died. Both halves matter here. The
// spec fixes neither when the count moves (on the hit, or when the replacement launches) nor
// how long a build may pause between the two — a pause is the normal way to play the
// destruction — so a fixed one-second window reads a build that pauses longer as never having
// respawned at all, and reports the wreck's pose as the respawn pose. The budget is
// deliberately generous for the same reason; nothing about the verdict depends on how much of
// it goes unused.
//
// The life count is compared against the 3 this check itself set, never against a count read
// out of a fresh game: what `lives` counts is a convention the spec leaves open (see
// `_helpers.mjs`), but one loss costing one life is not.

import {
  newGame,
  arrangeDoomedShip,
  actUntilShipLost,
  SAFE_X,
  SAFE_Y,
  FACE_UP,
  angleDelta,
} from "../_helpers.mjs";

const AT = { x: 300, y: 300 }; // where the ship is posed to die

export default function item() {
  // The loss and the respawn that followed it, read by `assert`.
  let outcome;

  return {
    id: "lives.respawn-safe-point",

    async arrange(api) {
      await newGame(api);
      await api.call("setLives", 3);
      await arrangeDoomedShip(api, AT);
      await api.call("setInvuln", 0); // collisions are live
    },

    async act(api) {
      outcome = await actUntilShipLost(api, { at: AT });
      await api.advance(180); // 1.5 s, so the clip holds on the new ship at the safe point
    },

    async assert(api, check) {
      const { lost, respawned } = outcome;
      const snap = respawned.snap;

      check.expectOk("the ship is destroyed by the collision", lost.hit);
      check.expectOk("a next ship comes out", respawned.hit);
      check.expectEq(
        "losing a ship costs exactly one life (respawn, not game over)",
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
      // Compared as a ROTATION to straight up, not as a number equal to -pi/2. The
      // case fixes no range for a facing — `specs/ship.md` writes this very value as
      // "270 degrees" while the snapshot reports radians — so a build keeping its
      // angle in [0, 2pi) reports the same ship pointing the same way as 4.712.
      // Subtracting would call that 2pi of error on a ship posed exactly right.
      check.expectClose(
        "the respawned ship faces up",
        angleDelta(snap.ship.angle, FACE_UP),
        0,
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
