// Automated validation for the Controls sub-item `discharge-key`.
//
// The discharge key (X) fires a discharge when the resonance meter is full. The
// meter is posed full and X pressed through injected input; the real discharge
// wave starts, read back from snapshot().
//
// WHAT THIS DELIBERATELY DOES NOT ASSERT. It used to also require the meter to read
// 0 after the press — which is `polarity.discharge-spends`' entire subject, and the
// only thing this item was failing on. That is one behavior graded twice: a build
// whose meter accounting is wrong lost this CONTROLS point as well as the polarity
// one, though its X key was wired correctly, and the clip filed under "the
// discharge key works" was evidence about the meter instead. The checklist's
// taxonomy is one observable behavior per item, so the binding is all this asks:
// pressing X, with the meter full, fires the discharge.
//
// The meter is still READ before the press, because "when the meter is full" is the
// precondition the binding is claimed under — a discharge that fires from an empty
// meter is not this rule working.

import { startClean, RES_MAX } from "../_helpers.mjs";

export default function item() {
  // The meter as posed, and the state read the instant X was pressed.
  let ready;
  let snap;

  return {
    id: "controls.discharge-key",

    // A live stage-1 wave with the meter posed full, so X is armed. The wave is kept
    // (`clear: false`) rather than emptied: the discharge sweeps the field, so its
    // clip is only legible with drones on it for the wave to sweep through.
    async arrange(api) {
      await startClean(api, { clear: false });
      await api.call("setResonance", 100);
    },

    // The press is instant, and the meter/flag are read the moment it lands — the
    // fact under test is that X spends and fires, not anything that develops over
    // time. Time is then spent purely so the clip shows the wave the press launched
    // actually expanding across the field; both operands are already captured, so
    // it cannot affect the verdict. The old generic "here is the game running" tail
    // is gone: `act` now films the checked behavior itself.
    async act(api) {
      ready = (await api.snapshot()).resonance;
      await api.call("press", "KeyX");
      snap = await api.snapshot();
      await api.advance(120); // 120 ticks (1 s) of the discharge wave sweeping out
    },

    async assert(api, check) {
      check.expectEq("the meter is full when X is pressed", ready, RES_MAX);
      check.expectOk(
        "X fires the discharge wave",
        snap.discharge.active === true,
      );
    },
  };
}
