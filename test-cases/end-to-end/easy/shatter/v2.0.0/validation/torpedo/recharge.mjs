// Automated validation (Warhead) for the Torpedo item `recharge`: after firing, the torpedo
// recharges over ~10 seconds, then is ready again. A torpedo is fired; halfway through the
// recharge it is still not ready (the HUD charge reads ~half), and after the full recharge
// it is ready.
//
// The ship's pose and the readied charge are the preconditions (`arrange`); the shot and the
// recharge that follows are the behavior (`act`), so the clip is the HUD gauge visibly filling
// back up. The recharge outlasts the record pass's filming budget, which is fine — the verdict
// comes from the uncapped validate pass, and the opening of the refill is what demonstrates it.
//
// 5 s x 120 Hz = 600 ticks to the halfway point, then a further 5.2 s = 624 ticks to carry past
// the full ~10 s recharge. TORPEDO_RECHARGE itself stays in SECONDS — that is the unit the game
// reports the recharge in.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The weapon halfway through the recharge, and once it has completed.
  let half;
  let full;

  return {
    id: "torpedo.recharge",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 300, y: 500, vx: 0, vy: 0, angle: 0 });
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF"); // fire, starting the recharge

      await api.advance(600); // halfway through the 10 s recharge
      half = await api.snapshot();

      await api.advance(624); // past the full recharge
      full = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the torpedo is not ready mid-recharge",
        half.torpedoReady,
        false,
      );
      check.expectClose(
        "the HUD charge reads about half",
        half.torpedoRecharge,
        0.5,
        0.12,
      );
      check.expectEq(
        "after ~10 s the torpedo is ready again",
        full.torpedoReady,
        true,
      );
    },
  };
}
