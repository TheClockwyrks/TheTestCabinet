// Automated validation for the Economy sub-item `sell-refund`.
//
// Selling a tower after a round has begun refunds a fraction (about 70%) of what was
// spent on it. The check starts a live round, places an Emitter (so it is no longer
// refundable in full), sells it, and confirms the refund is the floored 70% of its spend.
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
  let t;
  let spent;
  let refund;

  return {
    id: "economy.sell-refund",

    clipMs: clipBudget(LEAD_TICKS + TAIL_TICKS),

    async arrange(api) {
      await startRun(api, MAP.single, { energy: 100000, round: 1 });
      await api.call("startRound");
      const snap = await api.snapshot();
      const g = pathGeom(snap.paths[0]);
      t = await placeCovering(api, "emitter", g, g.length * 0.3);
      spent = (await api.snapshot()).towers.find((x) => x.id === t.id).spent;
    },

    // The mid-round sale — the behavior under test.
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
      check.expectEq(
        "a mid-round sell refunds the floored 70% of the spend",
        refund,
        Math.floor(spent * 0.7),
      );
    },
  };
}
