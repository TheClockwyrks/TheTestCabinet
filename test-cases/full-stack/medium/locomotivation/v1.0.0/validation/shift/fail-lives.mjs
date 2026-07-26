// Shift: exhausting the lives fails the shift (out of lives). Lives are set to one as a
// precondition, then a real train kills the worker; the respawn beat with no lives left
// resolves to a failure through the real rule.

import { setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot once the failure had resolved.
  let snap;

  return {
    id: "shift.fail-lives",

    // Pose the worker on the lane with a single life left. The train is spawned in `act`
    // so the clip shows it arrive rather than opening on the collision.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setLives", 1);
      await setTile(api, 8, 10);
    },

    async act(api) {
      await api.call("spawnTrain", {
        line: 10,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 400,
      });

      await api.advance(6); // 6 ticks = the old 0.1s — the lethal hit spends the last life
      await api.advance(72); // 72 ticks = the old 1.2s — the respawn beat resolves the failure
      snap = await api.snapshot();

      await api.settle(150); // let the shift-failed screen paint before capturing it
      await api.screenshot("result");
    },

    async assert(api, check) {
      check.expectEq(
        "out of lives fails the shift",
        snap.screen,
        "level-failed",
      );
      check.expectEq(
        "the failure reason is out of lives",
        snap.level.failReason,
        "out-of-lives",
      );
    },
  };
}
