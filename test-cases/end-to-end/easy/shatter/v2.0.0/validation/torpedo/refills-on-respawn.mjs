// Automated validation (Warhead) for the Homing-torpedo item `refills-on-respawn`: losing
// a ship refills the torpedo, so a respawned ship comes back with its torpedo charged and
// ready, cancelling any recharge in progress (specs/mode-warhead.md). A torpedo is fired and
// its recharge advanced partway (so it is mid-recharge, not ready); the ship is then destroyed
// and respawned, after which the torpedo must be ready again — refilled by the respawn.
//
// Only the cleared field, the ship's pose and the readied charge are preconditions (`arrange`).
// Everything after the shot — advancing the recharge, then posing and resolving the fatal
// collision — is the behavior, and it is all control ops plus time, so it lives in `act`. Note
// the death scenario is re-posed there with SETTERS rather than a fresh game: `api.reset` would
// take the clock back mid-phase and freeze the recording, which is why the runtime forbids it.
//
// 3.6 s x 120 Hz = 432 ticks (past the fired torpedo's 3.5 s life, so the charge is visibly
// mid-recharge), the death sweep runs to 1 s = 120 ticks polled a tick at a time so the life is
// seen the instant it is lost, and the settling advance is 0.5 s = 60 ticks.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

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

      await api.advance(432); // let the fired torpedo expire and the recharge advance partway
      await api.call("clearRocks"); // clear the wave that respawned meanwhile
      before = (await api.snapshot()).torpedoRecharge;

      // Destroy the ship and respawn it (lives remain), then advance a little more.
      await api.call("setLives", 3);
      await api.call("setInvuln", 0);
      await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 });
      await api.until((s) => s.lives < 3, { max: 120, poll: TICK });
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
