// Automated validation for the Bonds sub-item `any-chips`.
//
// A bonded cluster's outer bond pool is chipped by ANY damage type — not only a
// dedicated bond-breaker. The check poses a bonded Polymer under an ENERGY tower
// (Emitter) and runs the real sim: the bond pool must drain, proving an energy tower
// chips bonds too.

import { coverAndSpawn, unitById } from "../_helpers.mjs";

export default function item() {
  // Cross-phase state lives in the factory closure — each pass gets a fresh instance,
  // so nothing leaks from the validate pass into the recording.
  let unitId;
  let u0;
  let bond0;
  let r;

  return {
    id: "bonds.any-chips",

    // Pose the scenario with control ops: an Emitter (the ENERGY tower) beside the lane
    // and a bonded Polymer inside its coverage window.
    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "emitter",
        type: "polymer",
      }));
      u0 = unitById(await api.snapshot(), unitId);
      bond0 = u0.bond;
    },

    // The behavior under test, and the whole of the clip: the energy tower firing on the
    // cluster until its bond pool gives ground.
    async act(api) {
      // 180 ticks = the old 3 s cap; poll 6 = the old 0.1 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u != null && u.bond != null && u.bond < bond0;
        },
        { max: 180, poll: 6 },
      );
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
