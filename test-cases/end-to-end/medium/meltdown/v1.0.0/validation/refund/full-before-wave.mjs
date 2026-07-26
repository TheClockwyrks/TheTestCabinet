// Automated validation for the Refund sub-item `full-before-wave`.
//
// A tower sold before the wave it was placed on has started refunds its full spend
// (specs/towers.md), so the untimed opening build can be re-shaped without penalty.
// We set a known balance, place an Arc, and sell it in the same opening phase — the
// money returns to exactly where it started.

import { newGame, build } from "../_helpers.mjs";

export default function item() {
  let afterBuild;
  let afterSell;

  return {
    id: "refund.full-before-wave",

    // A known balance in the untimed opening phase, so the refund is read against an
    // exact starting number.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setMoney", 1000);
    },

    // The build-then-sell round trip is the behavior under test, so it is what the
    // clip shows: the Arc goes down, the balance drops, the Arc comes back up and the
    // balance returns.
    async act(api) {
      const id = await build(api, "arc", 10, 10);
      afterBuild = (await api.snapshot()).money;
      await api.call("sellTower", id);
      afterSell = (await api.snapshot()).money;
    },

    async assert(api, check) {
      check.expectEq("building the Arc costs 15", afterBuild, 985);
      check.expectEq(
        "selling before the wave refunds the full spend",
        afterSell,
        1000,
      );
    },
  };
}
