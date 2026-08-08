// Automated validation for the Heavies sub-item `nuclear-cracks`.
//
// Nuclear damage (the Reactor) cracks a heavy isotope — its hit points fall under
// nuclear fire. The check poses a heavy under a Reactor and runs on until its hit points
// drop.

import {
  coverAndPassThrough,
  unitById,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
} from "../_helpers.mjs";

const MAX_CRACK_TICKS = 240;
// An isotope carries 9 shells and a chain of two alphas and a beta (specs/matter.md), so
// there is far more to watch here than the single frame its hp first moved — the decays,
// the particles it sheds, the lighter isotope travelling on. The clip used to cut on that
// first frame; held for four seconds it shows the heavy actually coming apart.
const CRACK_ON_TICKS = 240;

export default function item() {
  let unitId;
  let hp0;
  let r;

  return {
    id: "heavies.nuclear-cracks",

    clipMs: clipBudget(LEAD_TICKS + MAX_CRACK_TICKS + CRACK_ON_TICKS),

    async arrange(api) {
      // Posed at the upstream edge of the tower's range, so the heavy travels the whole
      // coverage window and is still under fire at the end of the clip.
      ({ unitId } = await coverAndPassThrough(api, {
        kind: "reactor",
        type: "isotope",
      }));
      hp0 = unitById(await api.snapshot(), unitId).hp;
    },

    // The Reactor cracking the heavy — the behavior, and the clip.
    async act(api) {
      await api.advance(LEAD_TICKS);
      // 240 ticks = the old 4 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u == null || u.hp < hp0;
        },
        { max: MAX_CRACK_TICKS, poll: 3 },
      );
      await api.advance(CRACK_ON_TICKS);
    },

    async assert(api, check) {
      check.expectOk("nuclear damage cracks the heavy (hp drops)", r.hit);
    },
  };
}
