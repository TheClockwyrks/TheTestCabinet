// Automated validation for materials.scanner-range-tier.
//
// The scanner's range grows with its tier: a node too far to lock at the first scanner level (10
// tiles) locks once the second level (32 tiles, the full width) is bought. We bank the Resonite
// (so it is no longer needed) and place a Cryenite node 11 tiles away — nearer than the guaranteed
// deepstone Cryenite — then compare the first vs the second scanner level.

import { teleportInto, newRun, SPAWN_COL, ROCKBED_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let narrow;
  let s;

  return {
    id: "materials.scanner-range-tier",

    // A Cryenite node 11 tiles east — just beyond the first scanner level's 10-tile reach.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("giveMaterial", "resonite"); // so only Cryenite is still needed
      await api.call("setTile", col + 11, row, {
        kind: "material",
        material: "cryenite",
      }); // 11 tiles east

      await api.call("grantGear", { scanner: 2 }); // range 10 tiles → 11 is out of range
      narrow = (await api.snapshot()).scanner.locked;
    },

    // Buying the wider level IS the behavior under test, so it happens here and the clip shows the
    // indicator appearing the moment the range grows.
    async act(api) {
      await api.call("grantGear", { scanner: 3 }); // range 32 tiles (full width) → 11 is now in range
      s = (await api.snapshot()).scanner;
      await api.advance(36); // 36 ticks = 0.6 s, the old 600 ms clip tail
    },

    async assert(api, check) {
      check.expectEq(
        "out of range at the first scanner level — no lock",
        narrow,
        false,
      );
      check.expectEq(
        "the wider second level locks from farther",
        s.locked,
        true,
      );
      check.expectEq("it targets the Cryenite", s.target, "cryenite");
    },
  };
}
