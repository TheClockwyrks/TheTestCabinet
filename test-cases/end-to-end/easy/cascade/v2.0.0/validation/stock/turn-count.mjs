// Automated validation for the per-variant Stock-and-waste sub-item `turn-count`.
//
// A stock turn turns exactly the deal mode's turn count of cards onto the waste
// (Draw Three: three; Draw One: one), or all that remain if fewer than the count
// are left. The check reads the build's own `turnCount` from the snapshot, then
// confirms a real turn moves exactly that many — so the one item validates either
// variant. The beats around the clicks give the video output the visible turning.
//
// Both turns are the behavior under test, so both run in `act` and both are filmed.
// The second scenario is re-posed with `setBoard` rather than `pose`, whose leading
// `reset` is not allowed inside `act`; `setBoard` leaves every pile it does not name
// empty (specs/instrumentation.md), so naming only the stock also clears the waste
// the first turn filled — which is what the second scenario needs.
//
// The beats are `advance`, not `settle`: a stock turn resolves instantly (the build's
// `step` is a no-op off a running cascade), so an advance moves no game state and is
// purely clip pacing. Nothing here reads the canvas.

import { pose, someCards, ticksFor } from "../_helpers.mjs";

export default function item() {
  // The build's own turn count, and the board after each turn.
  let tc;
  let s1;
  let s2;

  return {
    id: "stock.turn-count",

    // A full stock: one turn should move exactly the turn count.
    async arrange(api) {
      await pose(api, { stock: someCards(6) }, 1);
      tc = (await api.snapshot()).turnCount;
    },

    async act(api) {
      await api.advance(ticksFor(200)); // 24 ticks
      await api.call("turnStock");
      await api.advance(ticksFor(500)); // 60 ticks
      s1 = await api.snapshot();

      // Fewer cards than the count remain: the turn takes all that are left.
      await api.call("setBoard", { stock: someCards(1) });
      await api.advance(ticksFor(150)); // 18 ticks
      await api.call("turnStock");
      await api.advance(ticksFor(400)); // 48 ticks
      s2 = await api.snapshot();
    },

    async assert(api, check) {
      check.expectGe("the deal mode turns at least one card", tc, 1);

      check.expectEq(
        "a stock turn turns exactly the deal mode's count onto the waste",
        s1.waste.length,
        tc,
      );
      check.expectEq(
        "the stock shrinks by exactly that count",
        s1.stock.length,
        6 - tc,
      );
      check.expectEq(
        "the fanned waste shows exactly the turned count",
        s1.wasteVisibleCount,
        tc,
      );

      check.expectEq(
        "with fewer cards than the turn count, the turn takes all that remain",
        s2.waste.length,
        1,
      );
      check.expectEq("the stock is now empty", s2.stock.length, 0);
    },
  };
}
