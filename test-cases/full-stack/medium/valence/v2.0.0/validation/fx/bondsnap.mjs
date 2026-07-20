// Automated validation for the FX sub-item `bondsnap`.
//
// A produced particle burst fires when a bond snaps and a free atom is shed from a
// cluster. The check chips a Polymer with a Cleaver and runs on until a "bondsnap" burst
// appears in the live effects list.

import { coverAndSpawn, TICK } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "fx.bondsnap",

    async arrange(api) {
      await coverAndSpawn(api, { kind: "cleaver", type: "polymer" });
    },

    // The Cleaver chipping the cluster until a bond snaps — which is both the check and
    // the burst the reviewer is being shown.
    async act(api) {
      // 300 ticks = the old 5 s cap. The old poll of 0.02 s is 1.2 ticks, which the
      // contract refuses; it meant "sample as finely as possible", and one TICK is the
      // finest there is — a burst is short-lived and must not be polled past.
      r = await api.until((s) => s.effects.some((e) => e.kind === "bondsnap"), {
        max: 300,
        poll: TICK,
      });
    },

    async assert(api, check) {
      check.expectOk("a bond-snap burst fires when an atom is shed", r.hit);
    },
  };
}
