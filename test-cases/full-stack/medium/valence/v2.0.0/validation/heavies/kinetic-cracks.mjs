// Automated validation for the Heavies sub-item `kinetic-cracks`.
//
// Kinetic damage (the Cleaver) cracks a heavy isotope — its hit points fall under
// kinetic fire. The check poses a heavy under a Cleaver and runs on until its hit points
// drop.

import { coverAndSpawn, unitById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let hp0;
  let r;

  return {
    id: "heavies.kinetic-cracks",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "cleaver",
        type: "isotope",
      }));
      hp0 = unitById(await api.snapshot(), unitId).hp;
    },

    // The Cleaver cracking the heavy — the behavior, and the clip.
    async act(api) {
      // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u == null || u.hp < hp0;
        },
        { max: 180, poll: 3 },
      );
    },

    async assert(api, check) {
      check.expectOk("kinetic damage cracks the heavy (hp drops)", r.hit);
    },
  };
}
