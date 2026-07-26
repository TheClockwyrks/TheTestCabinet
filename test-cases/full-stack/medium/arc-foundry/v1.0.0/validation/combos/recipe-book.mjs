// Automated validation for combos.recipe-book: the COMBOS overlay opens an in-game reference
// of every combination tower, read against the live board. This confirms the overlay is
// reachable and captures it with a board that puts all three ingredient states on screen (one
// piece selected, others owned, the rest missing); how the book reads and lays out is judged
// by eye from the capture.
//
// Laying out the board and selecting a piece is the arrange; OPENING the book is the behavior
// under test, so the V press, the read and the capture are the act.

import { startBuild, placeCandidate, snap } from "../_helpers.mjs";

// Let the overlay paint before the still is taken — books of this kind often animate in.
// 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

export default function item() {
  // The selected piece, and the board with the book open, read by `assert`.
  let coilId;
  let s;

  return {
    id: "combos.recipe-book",

    async arrange(api) {
      await startBuild(api);
      // A few base pieces at known (type, quality) so recipes read as partially covered, with one of
      // them selected so its ingredient reads differently from the ones the player merely owns.
      const coil = await placeCandidate(api, "coil", 1, 6, 6);
      coilId = coil.id;
      await placeCandidate(api, "capacitor", 1, 9, 6);
      await placeCandidate(api, "emitter", 1, 12, 6);
      await api.call("select", coil.id);
    },

    async act(api) {
      await api.call("press", "KeyV"); // toggle the combinations recipe book
      s = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("book");
    },

    async assert(api, check) {
      check.expectEq("the combinations recipe book overlay is open", s.overlays.combos, true);
      check.expectEq("a base piece is selected while the book is open", s.selected, coilId);
    },
  };
}
