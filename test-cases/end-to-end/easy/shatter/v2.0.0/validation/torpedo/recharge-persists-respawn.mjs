// Automated validation (Warhead) for the Torpedo item `recharge-persists-respawn`: the
// recharge is a property of the weapon, not the ship, so it keeps counting through a death
// and respawn rather than resetting. A torpedo is fired and the recharge advanced; the ship
// is then destroyed and respawned, after which the recharge must have continued from where
// it was (not reset to empty or full).
//
// Only the cleared field, the ship's pose and the readied charge are preconditions (`arrange`).
// Everything after the shot — advancing the recharge, then posing and resolving the fatal
// collision — is the behavior, and it is all control ops plus time, so it lives in `act`. Note
// the second scenario is re-posed there with SETTERS rather than a fresh game: `api.reset` would
// take the clock back mid-phase and freeze the recording, which is why the runtime forbids it.
//
// 3.6 s x 120 Hz = 432 ticks, the death sweep runs to 1 s = 120 ticks polled a tick at a time so
// the life is seen the instant it is lost, and the settling advance is 0.5 s = 60 ticks.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

export default function item() {
  // The recharge before the death, and the weapon state after the respawn.
  let before;
  let after;

  return {
    id: "torpedo.recharge-persists-respawn",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 300, y: 500, vx: 0, vy: 0, angle: 0 });
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF"); // fire, starting the recharge

      await api.advance(432); // let the fired torpedo expire and the recharge advance
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
      check.expectEq(
        "the recharge is not reset to ready by the respawn",
        after.torpedoReady,
        false,
      );
      check.expectGt(
        "the recharge kept counting through the death and respawn",
        after.torpedoRecharge,
        before,
      );
      check.expectLt(
        "it is still recharging (not refilled by the respawn)",
        after.torpedoRecharge,
        1,
      );
    },
  };
}
