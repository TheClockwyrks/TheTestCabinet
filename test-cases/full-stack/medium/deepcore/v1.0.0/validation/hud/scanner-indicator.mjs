// Automated validation for hud.scanner-indicator — the scanner direction/distance indicator is drawn
// only while locked onto a needed material, and hidden otherwise. We confirm no lock when far from a
// node, then a lock beside one, and record the locked indicator for the reviewer to eye.

import { newRun, SPAWN_COL, ROCKBED_ROW } from "../_helpers.mjs";

export default function item() {
  let far;
  let near;

  return {
    id: "hud.scanner-indicator",

    // A scanner fitted, but parked far from either buried node so nothing can be in range.
    async arrange(api) {
      await newRun(api);
      await api.call("grantGear", { scanner: 3 });
      await api.call("teleport", 2, 60); // far from either buried node
      far = (await api.snapshot()).scanner.locked;
    },

    // Moving beside a node is what makes the indicator appear, so it happens here and the clip
    // shows the drawn indicator the reviewer is asked to eye.
    async act(api) {
      await api.call("teleport", SPAWN_COL, ROCKBED_ROW);
      await api.call("setTile", SPAWN_COL + 1, ROCKBED_ROW, {
        kind: "material",
        material: "resonite",
      });
      near = (await api.snapshot()).scanner.locked;
      await api.advance(54); // 54 ticks = 0.9 s, the old 900 ms clip of the drawn indicator
    },

    async assert(api, check) {
      check.expectEq("no indicator when nothing is in range", far, false);
      check.expectEq("the indicator shows once locked on", near, true);
    },
  };
}
