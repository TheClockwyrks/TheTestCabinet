// Automated validation for the Ice band item `speeds`.
//
// The base lane speeds sit in a slow range, and each level speeds them up (about
// 1.06x per level). The lane speeds are read at level 1, then the level is
// rebuilt at level 2 and the per-lane ratio confirmed. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The per-lane speeds at each level. Both are settled the moment the level is
  // built, so both reads are instant and belong in `arrange`.
  let l1;
  let l2;

  return {
    id: "ice.speeds",

    async arrange(api) {
      await startCrossing(api);
      l1 = (await api.snapshot()).lanes.ice.map((l) => l.speed);
      await api.call("setLevel", 2);
      l2 = (await api.snapshot()).lanes.ice.map((l) => l.speed);
    },

    // Nothing has to happen for the check; the clip's job is to show the level-2
    // traffic whose speeds the assertions describe, so let it draw and capture it.
    async act(api) {
      // 0.12 s is 14.4 ticks, which the tick contract rejects rather than rounds. This
      // is a paint settle, so it rounds UP to 15 — never shorter than it was.
      await api.advance(15);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      for (let i = 0; i < l1.length; i += 1) {
        check.expectGe(
          `level-1 ice lane ${i} speed is in the slow range`,
          l1[i],
          1.4,
        );
        check.expectLe(
          `level-1 ice lane ${i} speed is in the slow range`,
          l1[i],
          2.6,
        );
      }
      for (let i = 0; i < l2.length; i += 1) {
        check.expectClose(
          `ice lane ${i} speeds up ~1.06x at level 2`,
          l2[i] / l1[i],
          1.06,
          0.01,
        );
      }
    },
  };
}
