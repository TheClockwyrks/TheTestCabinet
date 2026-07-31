// Automated validation for the Refund sub-item `full-before-wave`.
//
// A tower sold before the wave it was placed on has started refunds its full spend
// (specs/towers.md), so the untimed opening build can be re-shaped without penalty.
// We set a known balance, place an Arc, and sell it in the same opening phase — the
// money returns to exactly where it started.

import { newGame, build, actTail } from "../_helpers.mjs";

export default function item() {
  let afterBuild;
  let afterSell;

  return {
    id: "refund.full-before-wave",

    // Two held beats around a build-then-sell round trip that itself consumes no time.
    clipMs: 5500,

    // A known balance in the untimed opening phase, so the refund is read against an
    // exact starting number.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setMoney", 1000);
    },

    // The build-then-sell round trip is the behavior under test, so it is what the
    // clip shows: the Arc goes down, the balance drops, the Arc comes back up and the
    // balance returns.
    //
    // Every operation here is a control op that consumes no time, so as a drive this
    // is instantaneous — place, sell and both reads land inside one frame, and the
    // record pass films a balance that was 1000 before the pass began and is 1000
    // after it, with nothing in between. A reviewer sees no Arc, no deduction and no
    // refund. The two beats below are what make the round trip legible: one holds on
    // the placed Arc and the reduced balance, the other on the empty tile and the
    // balance restored. They cost the verdict nothing — both numbers are read before
    // either beat runs.
    async act(api) {
      const id = await build(api, "arc", 10, 10);
      afterBuild = (await api.snapshot()).money;
      await actTail(api); // hold on the placed Arc and the 985 balance

      await api.call("sellTower", id);
      afterSell = (await api.snapshot()).money;
      await actTail(api); // hold on the cleared tile and the balance back at 1000
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
