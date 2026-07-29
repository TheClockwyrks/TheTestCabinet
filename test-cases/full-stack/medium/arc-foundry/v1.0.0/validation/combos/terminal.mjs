// Automated validation for combos.terminal: a combination tower has no quality tier and cannot
// be quality-combined or fed as an ingredient into another recipe — it is terminal.
//
// Assembling the combo is the arrange; the refused combine attempt is the behavior under test
// and is the act.

import { assembleCombo, towerById, snap } from "../_helpers.mjs";

// A frame for the still. 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

export default function item() {
  // The combo before and after the refused combine, read by `assert`.
  let comboId;
  let c;
  let c2;

  return {
    id: "combos.terminal",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400, clear: false }));
    },

    async act(api) {
      c = towerById(await snap(api), comboId);

      // A combine attempt from the combo does nothing (it is not a base structure).
      await api.call("setCombineSet", []);
      await api.call("combine", comboId);
      c2 = towerById(await snap(api), comboId);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("terminal");
    },

    async assert(api, check) {
      check.expectEq("a combo has no quality tier", c.quality, null);
      check.expectEq("the combo is unchanged by a combine attempt (terminal)", c2.kind, "combo");
      check.expectEq("...still the same combination tower", c2.type, c.type);
    },
  };
}
