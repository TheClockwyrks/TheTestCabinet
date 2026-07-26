// Automated validation for the Heavies sub-item `nuclear-cracks`.
//
// Nuclear damage (the Reactor) cracks a heavy isotope — its hit points fall under
// nuclear fire. The check poses a heavy under a Reactor and runs on until its hit points
// drop.

import { coverAndSpawn, unitById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let hp0;
  let r;

  return {
    id: "heavies.nuclear-cracks",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "reactor",
        type: "isotope",
      }));
      hp0 = unitById(await api.snapshot(), unitId).hp;
    },

    // The Reactor cracking the heavy — the behavior, and the clip.
    async act(api) {
      // 240 ticks = the old 4 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u == null || u.hp < hp0;
        },
        { max: 240, poll: 3 },
      );
    },

    async assert(api, check) {
      check.expectOk("nuclear damage cracks the heavy (hp drops)", r.hit);
    },
  };
}
