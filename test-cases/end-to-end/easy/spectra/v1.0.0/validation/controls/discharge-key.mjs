// Automated validation for the Controls sub-item `discharge-key`.
//
// The discharge key (X) fires a discharge when the resonance meter is full. The
// meter is posed full and X pressed through injected input; the real discharge
// fires, spending the meter and starting the wave, read back from snapshot().

import { startClean } from "../_helpers.mjs";

export default function item() {
  // The state read the instant X was pressed.
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
      await api.call("press", "KeyX");
      snap = await api.snapshot();
      await api.advance(120); // 120 ticks (1 s) of the discharge wave sweeping out
    },

    async assert(api, check) {
      check.expectEq(
        "X spends the full meter on a discharge",
        snap.resonance,
        0,
      );
      check.expectOk(
        "X fires the discharge wave",
        snap.discharge.active === true,
      );
    },
  };
}
