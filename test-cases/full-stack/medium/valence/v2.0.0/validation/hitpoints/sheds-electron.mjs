// Automated validation for the Hit Points sub-item `sheds-electron`.
//
// Each strike strips one electron (one hit point) from an atom. The check poses a
// 5-electron atom under an Emitter and runs the real sim until its electron count
// falls, confirming an atom sheds electrons hit by hit.

import { coverAndSpawn, unitById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let e0;
  let r;

  return {
    id: "hitpoints.sheds-electron",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "emitter",
        type: "atom",
        electrons: 5,
      }));
      e0 = unitById(await api.snapshot(), unitId).electrons;
    },

    // The Emitter stripping the atom — the behavior, and the clip.
    async act(api) {
      // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u != null && u.electrons < e0;
        },
        { max: 180, poll: 3 },
      );
    },

    async assert(api, check) {
      check.expectEq("the atom starts at its full electron count", e0, 5);
      check.expectOk("the atom sheds an electron under fire", r.hit);
      check.expectLt(
        "its electron count fell",
        unitById(r.snap, unitId).electrons,
        e0,
      );
    },
  };
}
