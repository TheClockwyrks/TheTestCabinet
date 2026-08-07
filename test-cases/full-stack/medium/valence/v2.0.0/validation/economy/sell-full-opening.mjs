// Automated validation for the Economy sub-item `sell-full-opening`.
//
// A tower placed and sold during the untimed opening build phase (before round one)
// refunds its full cost. The check places an Emitter in the opening phase and sells it,
// confirming the refund equals the full spend.
//
// A PLAYBACK rather than a still. A sale is a change to two things at once — the tower
// leaves the board and the refund lands in the bank — and a photograph of the state
// afterwards proves neither: an empty spot and a number are only evidence of a sale if the
// reviewer saw the tower standing there and the number lower a moment before. So the tower
// is selected (its inspector and its sell control on screen), held, sold, and the board held
// again.

import {
  startRun,
  pathGeom,
  placeCovering,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let phase0;
  let t;
  let spent;
  let refund;

  return {
    id: "economy.sell-full-opening",

    clipMs: clipBudget(LEAD_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startRun(api, MAP.single, { energy: 100000 });
      phase0 = snap.phase;
      const g = pathGeom(snap.paths[0]);
      t = await placeCovering(api, "emitter", g, g.length * 0.3);
      spent = (await api.snapshot()).towers.find((x) => x.id === t.id).spent;
    },

    // The sale itself — the behavior under test. `settle` is a real repaint pause in both
    // passes, so the still shows the board after the refund rather than mid-update.
    async act(api) {
      // Selected first, so the tower, its range ring and its sell control are all on screen
      // — and so is the bank it is about to be refunded into.
      await api.call("selectTower", t.id);
      await api.settle(150);
      await api.advance(LEAD_TICKS);

      refund = await api.call("sellTower", t.id);

      // Held on the board the sale left: the spot freed, the energy read raised.
      await api.settle(150);
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the opening phase is the build phase", phase0, "build");
      check.expectEq(
        "a sell in the opening phase refunds in full",
        refund,
        spent,
      );
    },
  };
}
