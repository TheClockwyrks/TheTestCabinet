// Automated validation for the Stock-and-waste sub-item `waste-fan-shrink`.
//
// The fanned waste shows only the cards from the MOST RECENT stock turn, so playing
// the top card shrinks the fan (Draw Three: 3 -> 2 -> 1) instead of pulling a buried
// card up to keep it at the turn count. This is a common mistake: a build that fans
// `min(turnCount, waste.length)` re-shows a full fan after a card is played whenever
// buried cards remain, making the waste look like it still holds three playable cards
// when it holds fewer. The rule is that the fan only ever counts down as the turned
// group is consumed, and once that group is exhausted the waste squares back to a
// single visible top card (it does NOT re-fan the buried cards).
//
// The check poses a waste of `turnCount` freshly-turned cards over three buried ones
// (six in all) and plays the turned cards off the top one at a time, reading the
// fanned count after each through the `wasteVisible` helper. That count comes from
// the build's own `wasteVisibleCount` field, which is a Draw Three affordance
// present only in that build (specs/instrumentation.md); the Draw One deal never
// fans more than a single card and does not report the field, so the helper reads a
// missing value as one. It reads `turnCount` from the snapshot and derives every
// expected count from it, so the one item validates either deal mode: Draw Three
// counts 3 -> 2 -> 1 -> 1, and Draw One (which only ever fans one) stays 1 -> 1.
// Buried cards always remain, so the waste never empties and the count never falls
// below one.
//
// The turned cards are three Aces, played home onto three empty foundations (an empty
// foundation takes any Ace), so each removal is a real, legal move through the game's
// own move path. The posed board and its first reading are the precondition
// (`arrange`); playing the cards off the waste is the behavior under test, so those
// moves — and the fan shrinking between them — are what `act` films. The beats are
// `advance`, not `settle`: a move resolves instantly (the build's `step` is a no-op
// off a running cascade), so an advance moves no game state and is purely clip pacing.

import { card, pose, ticksFor, wasteVisible } from "../_helpers.mjs";

export default function item() {
  // The build's own turn count, the initial waste length, and the fanned count read
  // before any play and after each card is played off the top.
  let tc;
  let wasteLen0;
  const visible = [];
  const accepted = [];

  return {
    id: "stock.waste-fan-shrink",

    // Three buried cards under three face-up Aces on top; foundations empty. setBoard
    // fans the waste as the most recent turn, clamped to the deal mode's turn count,
    // so the fan starts at exactly the turn count.
    async arrange(api) {
      await pose(
        api,
        {
          waste: [
            card("clubs", 5, true),
            card("clubs", 6, true),
            card("clubs", 7, true),
            card("diamonds", 1, true),
            card("hearts", 1, true),
            card("spades", 1, true),
          ],
        },
        1,
      );
      const s0 = await api.snapshot();
      tc = s0.turnCount;
      wasteLen0 = s0.waste.length;
      visible.push(wasteVisible(s0));
    },

    async act(api) {
      await api.advance(ticksFor(300)); // 36 ticks — show the opening fan
      // Play the turned cards off the top, each Ace home onto its own empty
      // foundation, reading the fanned count after each removal.
      for (let r = 0; r < tc; r += 1) {
        const ok = await api.call(
          "move",
          { pile: "waste" },
          { pile: "foundation", index: r },
        );
        accepted.push(ok);
        await api.advance(ticksFor(450)); // 54 ticks — let the fan shrink on screen
        visible.push(wasteVisible(await api.snapshot()));
      }
    },

    async assert(api, check) {
      check.expectGe("the deal mode turns at least one card", tc, 1);

      // The fan starts at the turn count (clamped to the waste it holds).
      const start = Math.min(tc, wasteLen0);
      check.expectEq(
        "the fresh fan shows exactly the turned count",
        visible[0],
        start,
      );

      // Each play shrinks the fan by one; once the turned group is gone the waste
      // squares to a single top card over the buried ones (never re-fanning them).
      for (let r = 1; r <= tc; r += 1) {
        check.expectEq(`playing card ${r} was accepted`, accepted[r - 1], true);
        check.expectEq(
          `after playing ${r} card(s), the fan shows one fewer (not a refilled fan)`,
          visible[r],
          Math.max(1, start - r),
        );
      }
    },
  };
}
