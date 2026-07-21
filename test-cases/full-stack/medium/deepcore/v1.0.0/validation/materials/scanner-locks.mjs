// Automated validation for materials.scanner-locks.
//
// With a needed material in range the scanner locks on, naming the material and pointing toward it.
// We place a Resonite node one tile east of the miner and confirm the scanner locks with the right
// target and an eastward direction.

import { newRun, SPAWN_COL, ROCKBED_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let s;

  return {
    id: "materials.scanner-locks",

    // The widest scanner, with a needed Resonite node placed one tile east of the miner.
    async arrange(api) {
      await newRun(api);
      await api.call("grantGear", { scanner: 3 }); // the widest scanner so the near node is in reach
      await api.call("teleport", col, row);
      await api.call("setTile", col + 1, row, {
        kind: "material",
        material: "resonite",
      }); // one tile east
      s = (await api.snapshot()).scanner;
    },

    // A beat of live play so the clip shows the drawn lock indicator the checks are about.
    // 42 ticks = 0.7 s, the old 700 ms tail.
    async act(api) {
      await api.advance(42);
    },

    async assert(api, check) {
      check.expectEq("the scanner locks on", s.locked, true);
      check.expectEq("it targets the needed Resonite", s.target, "resonite");
      check.expectGt("it points toward the node (east)", s.dirX, 0);
    },
  };
}
