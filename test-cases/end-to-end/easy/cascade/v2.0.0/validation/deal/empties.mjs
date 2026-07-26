// Automated validation for the Deal sub-item `empties`.
//
// A fresh deal leaves the waste and all four foundations empty (only the tableau
// and the stock hold cards). The real deal runs and the piles are read back.
//
// The deal is instant and begins with a `reset` (arrange-only), so it is posed in
// `arrange`; `act` films the dealt table, where the empty waste and foundations the
// assertions read are what a reviewer sees.

import { actShoot, deal } from "../_helpers.mjs";

export default function item() {
  // The post-deal snapshot.
  let s;

  return {
    id: "deal.empties",

    async arrange(api) {
      s = await deal(api, 12);
    },

    async act(api) {
      await actShoot(api, "empties");
    },

    async assert(api, check) {
      check.expectEq("the waste is empty after the deal", s.waste.length, 0);
      for (let i = 0; i < 4; i += 1) {
        check.expectEq(
          `foundation ${i + 1} is empty after the deal`,
          s.foundations[i].length,
          0,
        );
      }
    },
  };
}
