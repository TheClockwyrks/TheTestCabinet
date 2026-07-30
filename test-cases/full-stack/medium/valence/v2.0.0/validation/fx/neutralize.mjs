// Automated validation for the FX sub-item `neutralize`.
//
// A produced particle burst fires when a unit is neutralized. The check poses a
// 1-electron atom under an Emitter (one hit neutralizes it) and runs on until a
// "neutralize" burst appears in the live effects list.

import { coverAndSpawn, TICK } from "../_helpers.mjs";

// The clip used to cut on the frame the burst first appeared, which shows a burst starting
// and never playing. A produced particle system is SIMULATED (specs/assets.md), so a reviewer
// judging it needs to watch it play out on the now-empty conduit.
const TAIL_TICKS = 90;

export default function item() {
  let r;

  return {
    id: "fx.neutralize",

    async arrange(api) {
      await coverAndSpawn(api, { kind: "emitter", type: "atom", electrons: 1 });
    },

    // The single shot that neutralizes the atom, and the burst it fires.
    async act(api) {
      // 180 ticks = the old 3 s cap. The old poll of 0.02 s is 1.2 ticks, which the
      // contract refuses; it meant "sample as finely as possible", and one TICK is the
      // finest there is — a burst is short-lived and must not be polled past.
      r = await api.until(
        (s) => s.effects.some((e) => e.kind === "neutralize"),
        {
          max: 180,
          poll: TICK,
        },
      );
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a neutralize burst fires when a unit is killed", r.hit);
    },
  };
}
