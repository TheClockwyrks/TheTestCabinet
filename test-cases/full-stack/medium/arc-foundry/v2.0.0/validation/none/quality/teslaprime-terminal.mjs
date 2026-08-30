// Automated validation for quality.teslaprime-terminal: a Tesla-Prime (T5) piece offers no
// quality-combine — the top rung cannot climb further.
//
// Two Tesla-Prime capacitors are placed and a combine attempted; both remain, and no higher
// tier is produced.
//
// Placing the pair and naming the combine set are the arrange; the REFUSED fold is the behavior
// under test and is the act.

import { startBuild, placeCandidate, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows both apex pieces still standing. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The initiator, and the board after the refused fold.
  let aId;
  let s;

  return {
    id: "quality.teslaprime-terminal",

    async arrange(api) {
      await startBuild(api);
      const a = await placeCandidate(api, "capacitor", 5, 6, 7);
      const b = await placeCandidate(api, "capacitor", 5, 10, 7);
      aId = a.id;
      await api.call("setCombineSet", [a.id, b.id]);
    },

    async act(api) {
      await api.call("combine", aId); // refused: T5 is the apex
      s = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("apex");
    },

    async assert(api, check) {
      check.expectEq(
        "both Tesla-Prime pieces remain (no further combine)",
        s.towers.filter((t) => t.kind === "candidate" && t.quality === 5).length,
        2,
      );
      check.expectEq("no tier above Tesla-Prime was produced", s.towers.filter((t) => t.quality > 5).length, 0);
    },
  };
}
