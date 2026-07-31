// Automated validation (Warhead) for the Homing-torpedo item `refills-on-respawn`: losing
// a ship refills the torpedo, so a respawned ship comes back with its torpedo charged and
// ready, cancelling any recharge in progress (specs/gameplay.md). A torpedo is fired and
// its recharge advanced partway (so it is mid-recharge, not ready); the ship is then destroyed
// and respawned, after which the torpedo must be ready again — refilled by the respawn.
//
// Only the cleared field, the ship's pose and the readied charge are preconditions (`arrange`).
// Everything after the shot — advancing the recharge, then posing and resolving the fatal
// collision — is the behavior, and it is all control ops plus time, so it lives in `act`. The
// death scenario is re-posed there with SETTERS rather than a fresh game, so the recording
// stays one continuous take of the weapon going from mid-recharge to refilled.
//
// The death is driven through `actUntilShipLost`, which waits for the life to come off the
// count and THEN for the next ship to actually be out. That second half is the point here: the
// claim is about what the RESPAWNED ship carries, and the spec bounds neither when a build
// takes the life nor how long it pauses on the destruction before launching the replacement
// (see `_helpers.mjs`). The fixed one-second sweep this replaces expires mid-pause on a build
// that plays the loss out, and the charge would then be read off a ship that had not respawned
// yet — reporting a refill that never had the chance to happen.
//
// 3.6 s x 120 Hz = 432 ticks (past the fired torpedo's 3.5 s life, so the charge is visibly
// mid-recharge), and the settling advance is 0.5 s = 60 ticks.
//
// That 3.6 s is `skip`ped rather than advanced: it is a torpedo flying out its life and a bar
// creeping up, the journey to the state under test rather than the test itself, and filming it
// spends most of the clip (and most of the budget) before the death this item is about even
// happens. Skipping runs the same simulation to the same state instantly in both passes, so
// the recharge read below is unchanged and the clip opens on a ship about to be lost.

import {
  newGame,
  poseShip,
  arrangeDoomedShip,
  actUntilShipLost,
} from "../_helpers.mjs";

const AT = { x: 300, y: 300 }; // where the ship is posed to die

export default function item() {
  // The recharge before the death (mid-recharge), and the weapon state after the respawn.
  let before;
  let after;

  return {
    id: "torpedo.refills-on-respawn",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 300, y: 500, vx: 0, vy: 0, angle: 0 });
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF"); // fire, starting the recharge

      await api.skip(432); // let the fired torpedo expire and the recharge advance partway
      await api.call("clearRocks"); // clear the wave that respawned meanwhile
      before = (await api.snapshot()).torpedoRecharge;

      // Destroy the ship and let the game bring the next one out (lives remain).
      await api.call("setLives", 3);
      await arrangeDoomedShip(api, AT);
      await api.call("setInvuln", 0);
      await actUntilShipLost(api, { at: AT });
      await api.call("clearRocks");
      await api.advance(60);
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectLt(
        "the torpedo was mid-recharge before the death (not already ready)",
        before,
        1,
      );
      check.expectEq(
        "the respawn refills the torpedo — it is ready again",
        after.torpedoReady,
        true,
      );
      check.expectClose(
        "the recharge is full after the respawn",
        after.torpedoRecharge,
        1,
        1e-6,
      );
    },
  };
}
