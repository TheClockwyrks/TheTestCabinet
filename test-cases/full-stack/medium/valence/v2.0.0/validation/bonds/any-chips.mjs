// Automated validation for the Bonds sub-item `any-chips`.
//
// A bonded cluster's outer bond pool is chipped by ANY damage type — not only a
// dedicated bond-breaker. The check poses a bonded Polymer under an ENERGY tower
// (Emitter) and runs the real sim: the bond pool must drain, proving an energy tower
// chips bonds too.

import {
  coverAndPassThrough,
  unitById,
  clipBudget,
  LEAD_TICKS,
} from "../_helpers.mjs";

// How long to keep filming the Emitter working on the pool after the first chip lands.
// The first chip is one shot out of the eleven a Polymer's pool can absorb, and a clip that
// cuts on it shows a number twitch once. Held for four seconds the reviewer watches the arc
// drain step by step under a tower that is not supposed to be able to touch it, which is the
// claim the item is actually making.
const DRAIN_TICKS = 240;
// The sweep's own cap, so the budget below covers the worst case rather than the typical one.
const MAX_CHIP_TICKS = 180;

export default function item() {
  // Cross-phase state lives in the factory closure — each pass gets a fresh instance,
  // so nothing leaks from the validate pass into the recording.
  let unitId;
  let u0;
  let bond0;
  let r;

  return {
    id: "bonds.any-chips",

    // Longer than the runtime's default 8 s, because the framing above is deliberately
    // longer than that: without this the record pass would stop mid-drain and hand back
    // exactly the clip this item was faulted for.
    clipMs: clipBudget(LEAD_TICKS + MAX_CHIP_TICKS + DRAIN_TICKS),

    // Pose the scenario with control ops: an Emitter (the ENERGY tower) beside the lane
    // and a bonded Polymer inside its coverage window.
    // Posed at the upstream edge of the Emitter's range (rather than in the middle of it),
    // so the Polymer travels the whole coverage window and stays under fire for the length
    // of the clip instead of walking out of range halfway through it.
    async arrange(api) {
      ({ unitId } = await coverAndPassThrough(api, {
        kind: "emitter",
        type: "polymer",
      }));
      u0 = unitById(await api.snapshot(), unitId);
      bond0 = u0.bond;
    },

    // The behavior under test, and the whole of the clip: the energy tower firing on the
    // cluster until its bond pool gives ground.
    async act(api) {
      // The cluster as posed, pool full, before the Emitter's first shot reaches it.
      await api.advance(LEAD_TICKS);
      // 180 ticks = the old 3 s cap; poll 6 = the old 0.1 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u != null && u.bond != null && u.bond < bond0;
        },
        { max: MAX_CHIP_TICKS, poll: 6 },
      );
      // ...and the pool going on draining, shot after shot.
      await api.advance(DRAIN_TICKS);
    },

    async assert(api, check) {
      check.expectOk(
        "the unit starts bonded with a bond pool",
        u0.traits.bonded && u0.bond > 0,
      );
      check.expectOk(
        "an energy tower chips the bond pool (not only a bond-breaker)",
        r.hit,
      );
      // Guarded: a build that opened or removed the cluster instead of chipping it has
      // nothing to read back, which is a failure of this item rather than of the API.
      const chipped = unitById(r.snap, unitId);
      check.expectLt(
        "the bond pool fell under energy fire",
        chipped && chipped.bond != null ? chipped.bond : bond0,
        bond0,
      );
    },
  };
}
