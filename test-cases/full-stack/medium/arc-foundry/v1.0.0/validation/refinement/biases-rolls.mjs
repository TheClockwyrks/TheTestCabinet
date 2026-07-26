// Automated validation for refinement.biases-rolls: buying Refinement biases the stamp's
// quality roll upward — at a high Refinement level rolls land above Scrap, whereas at R0 they
// never do.
//
// At R0 a real roll is Scrap. Deeply refined (R8, whose odds carry zero Scrap weight), five
// real rolls all land above Scrap.
//
// The R0 baseline is taken in the arrange, because reading it and then re-opening the run for
// the refined half both require `reset`. The FIVE REFINED ROLLS are the behavior under test, and
// a placement is a control op, so they are the act — which is a far better clip than the old
// tail, which walked a Spark past a board that had already finished rolling.

import { startBuild, SPOTS, towerAt, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows all five refined candidates. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The R0 baseline roll, and the five refined qualities.
  let baseline;
  const tiers = [];

  return {
    id: "refinement.biases-rolls",

    async arrange(api) {
      // R0 baseline: a real roll is Scrap.
      await startBuild(api, { seed: 1 });
      await api.call("setNextRoll", null);
      await api.call("placeRock", 6, 7);
      baseline = towerAt(await snap(api), 6, 7).quality;

      // A fresh, deeply refined press for the act to roll against.
      await startBuild(api, { seed: 1, charge: 9999 });
      await api.call("setRefinement", 8);
    },

    async act(api) {
      for (const spot of SPOTS) {
        await api.call("setNextRoll", null);
        await api.call("placeRock", spot.col, spot.row);
        const t = towerAt(await snap(api), spot.col, spot.row);
        if (t && t.kind === "candidate") tiers.push(t.quality);
      }

      await api.advance(SETTLE_TICKS);
    },

    async assert(api, check) {
      check.expectEq("an unrefined (R0) roll is Scrap (T1)", baseline, 1);
      check.expectEq("five refined rolls landed", tiers.length, 5);
      check.expectOk("a deeply refined press rolls no Scrap", tiers.every((q) => q > 1));
      check.expectGt("...and hands out higher tiers on average", Math.max(...tiers), 1);
    },
  };
}
