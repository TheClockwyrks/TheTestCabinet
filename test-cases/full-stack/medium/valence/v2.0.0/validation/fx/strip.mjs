// Automated validation for the FX sub-item `strip`.
//
// A produced particle burst fires when a shell is stripped from a unit. The check poses a
// large atom under an Emitter and runs on until a "strip" burst appears in the snapshot's
// live effects list. (Whether the produced burst looks good is reviewed by a person from the clip.)

import { coverAndSpawn, TICK } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "fx.strip",

    async arrange(api) {
      await coverAndSpawn(api, { kind: "emitter", type: "atom", electrons: 6 });
    },

    // The Emitter stripping shells off the atom, and the spark each strip throws.
    async act(api) {
      // 180 ticks = the old 3 s cap. The old poll of 0.02 s is 1.2 ticks, which the
      // contract refuses; it meant "sample as finely as possible", and one TICK is the
      // finest there is — a burst is short-lived and must not be polled past.
      r = await api.until((s) => s.effects.some((e) => e.kind === "strip"), {
        max: 180,
        poll: TICK,
      });
    },

    async assert(api, check) {
      check.expectOk(
        "a strip-spark burst fires when a shell is stripped",
        r.hit,
      );
    },
  };
}
