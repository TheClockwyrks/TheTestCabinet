// Automated validation for the Lives item `invuln-ends`: once the invulnerability window
// is over, collisions are lethal again. A rock is parked on the ship and a SHORT grace
// window is set, so the same resting contact is harmless while the window runs and lethal
// the moment it lapses — which is the claim, rather than the weaker "a collision with no
// grace window is lethal".
//
// Posing the protected ship with a rock sitting on it is instant (`arrange`); riding out the
// window and then being killed by the contact that was just survived is the behavior (`act`),
// so the clip shows the ship blink through the rock and then die on it.
//
// The lethal half waits through `actUntilShipLost` rather than a fixed window: the spec fixes
// neither when a build takes the life off the count nor how long it pauses on the destruction
// (see `_helpers.mjs`), so a one-second budget reads a build that pauses longer as never
// having registered the hit. The life count is compared against the 3 this check itself set,
// never against a count read out of a fresh game.

import {
  newGame,
  arrangeDoomedShip,
  actUntilShipLost,
  TICK,
  ticks,
} from "../_helpers.mjs";

const AT = { x: 300, y: 300 }; // where the ship is posed, with the rock on top of it
const GRACE = 0.5; // seconds of invulnerability to ride out (setInvuln takes seconds)

export default function item() {
  // Whether the contact was survived while protected, and what it did once it was not.
  let whileProtected;
  let outcome;

  return {
    id: "lives.invuln-ends",

    async arrange(api) {
      await newGame(api);
      await api.call("setLives", 3);
      await arrangeDoomedShip(api, AT);
      await api.call("setInvuln", GRACE); // seconds — a window that runs out during `act`
    },

    async act(api) {
      // While the window is open the resting contact must cost nothing. 0.4 s x 120 Hz = 48
      // ticks, comfortably inside the 0.5 s set above.
      whileProtected = await api.until(
        (s) => s.lives < 3 || s.screen !== "playing",
        { max: 48, poll: TICK },
      );

      // The window lapses; the same contact must now be lethal. The count above is
      // passed through as the baseline rather than re-read here: the sweep that just
      // ran is exact in the validate pass (the ship is still protected at the end of
      // it, which is the point) but covers more ground on the record pass's wall
      // clock, where the loss can land inside it. Re-reading would leave this waiting
      // out its whole budget for a second loss nothing arranged, and the recording
      // would end long after the death it is meant to show.
      outcome = await actUntilShipLost(api, {
        at: AT,
        max: ticks(6),
        lives: 3,
      });
      await api.advance(90); // 0.75 s tail, so the clip carries past the loss
    },

    async assert(api, check) {
      check.expectOk(
        "the contact costs nothing while the invulnerability window is open",
        !whileProtected.hit,
      );
      check.expectOk(
        "with invulnerability over, the collision is lethal",
        outcome.lost.hit,
      );
      check.expectEq(
        "the ship is destroyed and a life is lost",
        outcome.respawned.snap.lives,
        2,
      );
    },
  };
}
