// Automated validation for the FX sub-item `split`.
//
// A produced particle burst fires when a heavy isotope decays and sheds a fragment. The
// check cracks a heavy with a Reactor and runs on until a "split" burst appears in the
// live effects list.

import { coverAndSpawn, TICK } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "fx.split",

    async arrange(api) {
      await coverAndSpawn(api, { kind: "reactor", type: "isotope" });
    },

    // The Reactor cracking the heavy, and the split flash it throws.
    async act(api) {
      // 300 ticks = the old 5 s cap. The old poll of 0.02 s is 1.2 ticks, which the
      // contract refuses; it meant "sample as finely as possible", and one TICK is the
      // finest there is — a burst is short-lived and must not be polled past.
      r = await api.until((s) => s.effects.some((e) => e.kind === "split"), {
        max: 300,
        poll: TICK,
      });
    },

    async assert(api, check) {
      check.expectOk("a split-flash burst fires when a heavy decays", r.hit);
    },
  };
}
