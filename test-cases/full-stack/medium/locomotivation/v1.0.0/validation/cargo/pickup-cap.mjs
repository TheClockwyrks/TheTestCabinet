// Cargo: a pickup that would push the load past the weight cap is refused. The worker
// already carries a "load" (80 of 120); a real E press at a ground "load" (80) would
// total 160 > 120, so the pickup is denied and the package stays on the ground.

import { actPressStep, setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot after the refused pickup.
  let snap;

  return {
    id: "cargo.pickup-cap",

    // Pose the worker already holding a "load", standing on a second one — together far
    // over the cap, so the pickup must be refused.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 10, 12);
      await api.call("givePackage", {
        color: "red",
        weightClass: "load",
        archetype: "dispenser",
      });
      await api.call("spawnGroundPackage", {
        col: 10,
        row: 12,
        color: "blue",
        weightClass: "load",
        archetype: "optional",
      });
    },

    // The refused pickup: press E and advance one tick so its edge resolves.
    async act(api) {
      snap = await actPressStep(api, "KeyE");

      // Hold so the clip shows the package still sitting there. 36 ticks = the old
      // 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "the over-cap pickup is refused (still carrying one)",
        snap.worker.carried.length,
        1,
      );
      check.expectEq(
        "the refused package stays on the ground",
        snap.ground.length,
        1,
      );
    },
  };
}
