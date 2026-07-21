// Automated validation for the Deal sub-item `stock-count`.
//
// After the seven tableau columns take 1+2+...+7 = 28 cards, the remaining 24
// cards form the face-down stock. The real deal runs and the stock is read back.
//
// The deal is instant and begins with a `reset` (arrange-only), so it is posed in
// `arrange`; `act` films the dealt table, whose face-down stock is what the
// assertions count.

import { actShoot, deal } from "../_helpers.mjs";

export default function item() {
  // The post-deal snapshot.
  let s;

  return {
    id: "deal.stock-count",

    async arrange(api) {
      s = await deal(api, 7);
    },

    async act(api) {
      await actShoot(api, "stock");
    },

    async assert(api, check) {
      check.expectEq(
        "the stock holds 24 cards after the deal",
        s.stock.length,
        24,
      );
      check.expectOk(
        "every stock card is face-down",
        s.stock.every((c) => c.faceUp === false),
      );
    },
  };
}
