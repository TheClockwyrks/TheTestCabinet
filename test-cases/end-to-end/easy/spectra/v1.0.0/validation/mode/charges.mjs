// Automated validation for the overload variant's Mode sub-item `mode.charges`.
//
// In Overload a mismatched (wrong-band) shot no longer wastes: it adds one charge to
// the drone, so successive wrong-band hits advance the charge 0 → 1 → 2. A Shard is
// posed and hit twice with the wrong band; the real charge, read from snapshot(),
// advances each time. The on-drone charge telegraph is captured.

import { startClean, spawnDrone, findDrone, shootDrone } from "../_helpers.mjs";

const CHARGE_MAX_TICKS = 48; // 48 ticks = the old 0.4 s cap on a hit registering

export default function item() {
  // The Shard, its charge at spawn, and its charge after each wrong-band hit.
  let shardId;
  let charge0;
  let charge1;
  let charge2;

  return {
    id: "mode.charges",

    // One uncharged Shard on an empty field, its charge read instantly at spawn.
    async arrange(api) {
      await startClean(api);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      charge0 = findDrone(await api.snapshot(), shardId).charge;
    },

    async act(api) {
      await shootDrone(api, shardId, "magenta"); // wrong band
      await api.until((s) => (findDrone(s, shardId)?.charge ?? 0) >= 1, {
        max: CHARGE_MAX_TICKS,
      });
      charge1 = findDrone(await api.snapshot(), shardId).charge;

      await shootDrone(api, shardId, "magenta"); // wrong band again
      await api.until((s) => (findDrone(s, shardId)?.charge ?? 0) >= 2, {
        max: CHARGE_MAX_TICKS,
      });
      charge2 = findDrone(await api.snapshot(), shardId).charge;

      // The capture is the point of this item — the reviewer judges the on-drone
      // charge telegraph by eye. `settle` is a real pause in both passes, and in the
      // validate pass it is the only thing that paints a frame at all, so without it
      // the screenshot could show the drone before its second charge was drawn.
      await api.settle(120);
      await api.screenshot("telegraph");
    },

    async assert(api, check) {
      check.expectEq("the drone starts uncharged", charge0, 0);
      check.expectEq("the first wrong-band hit charges to 1", charge1, 1);
      check.expectEq("the second wrong-band hit charges to 2", charge2, 2);
    },
  };
}
