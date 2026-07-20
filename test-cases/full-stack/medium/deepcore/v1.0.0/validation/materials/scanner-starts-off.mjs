// Automated validation for materials.scanner-starts-off.
//
// You start with NO scanner (tier 1 = no scanner), so nothing ever locks — even right beside a
// needed material. Buying the first scanner level enables the lock. We place a Resonite node one
// tile east, confirm no lock at the start, then buy the first level and confirm it locks on.

import { newRun, SPAWN_COL, ROCKBED_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let unfitted;
  let s;

  return {
    id: "materials.scanner-starts-off",

    // A needed Resonite node right beside the miner, with every track still at tier 1.
    async arrange(api) {
      await newRun(api); // fresh expedition — every track at tier 1, so no scanner
      await api.call("teleport", col, row);
      await api.call("setTile", col + 1, row, {
        kind: "material",
        material: "resonite",
      }); // one tile east
      unfitted = (await api.snapshot()).scanner.locked;
    },

    // Buying the first level IS the behavior under test, so it happens here and the clip shows the
    // indicator appearing where a moment earlier there was none.
    async act(api) {
      await api.call("grantGear", { scanner: 2 }); // buy the first scanner level (range 10)
      s = (await api.snapshot()).scanner;
      await api.advance(42); // 42 ticks = 0.7 s, the old 700 ms clip tail
    },

    async assert(api, check) {
      check.expectEq(
        "no scanner at the start — nothing locks even beside a node",
        unfitted,
        false,
      );
      check.expectEq("buying the first level enables the lock", s.locked, true);
      check.expectEq("it targets the needed Resonite", s.target, "resonite");
    },
  };
}
