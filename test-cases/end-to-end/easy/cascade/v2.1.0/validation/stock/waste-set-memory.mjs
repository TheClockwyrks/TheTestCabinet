// Automated validation for the Stock-and-waste sub-item `waste-set-memory`.
//
// The waste keeps each stock turn's cards together as a set and remembers those sets
// in the order they were turned, so what it shows once a set has been played off is
// whatever is LEFT of the set turned before it (specs/rules.md). A build that tracks
// only "how many did the last turn bring over" gets every reading right until a set
// is emptied over a partly-played one, and then shows a single squared card where
// two are owed; a build that fans `min(turnCount, waste.length)` shows three. Both
// pass every within-one-set check, including `waste-fan-shrink`, because the two
// models only disagree once a second turn has been played off on top of a first.
//
// The check drives the real stock through three turns, playing off the waste between
// them, and reads the fan after each (Draw Three, turn count 3):
//
//   turn 1  →  a set of 3, none played, which stays buried for the rest of the run
//   turn 2  →  a set of 3, of which 1 is played home, leaving 2 on it
//   turn 3  →  a set of 3, all 3 played home, which empties that set
//   then    →  the waste shows the 2 still on the set from turn 2
//
// The third reading is the item. Two is what the rule owes; one is the last-turn
// counter, three is the refilled fan — and the waste holds 5 cards at that point, so
// neither wrong answer is clamped into the right one by the size of the pile. The
// top card is checked by identity as well as by count, so a build cannot pass by
// showing two cards that are not the ones it kept.
//
// Every card is turned by `turnStock` and played by `move`, so the sets come from the
// build's own stock code rather than from a posed waste. Only the stock is posed:
// three turns' worth of cards, ordered so that the card on top of the waste after
// turn 2 is an Ace (playable onto an empty foundation) and the cards left behind it
// are not. `turnCount` is read from the snapshot and every expectation derived from
// it, so the one item validates either deal mode; Draw One turns single-card sets,
// where the set from turn 2 is the one card it holds.
//
// All of it is `act` rather than `arrange`: the sets being remembered ARE the
// behavior, so the clip has to show them being built. The beats are `advance`, which
// moves no game state off a running cascade (the build's `step` is a documented
// no-op there) and is purely clip pacing.

import { card, pose, ticksFor, wasteVisible } from "../_helpers.mjs";

// Clip pacing: a beat after each turn and each card played home.
const BEAT = ticksFor(400); // 48 ticks

// Cards that no empty foundation and no empty tableau will take, so they stay on the
// waste however the scenario is driven.
const FILLERS = [
  card("spades", 5),
  card("hearts", 6),
  card("clubs", 7),
  card("diamonds", 8),
  card("spades", 9),
];

const ACES = [
  card("hearts", 1),
  card("diamonds", 1),
  card("clubs", 1),
  card("spades", 1),
];

/**
 * The stock for a deal mode that turns `tc` cards, bottom to top. `turnStock` takes
 * from the top, so the LAST `tc` cards are turn 1's set, the ones before them turn
 * 2's, and the ones before those turn 3's.
 *
 * Turn 2's set is laid out with its Ace at the bottom of its slice, which puts that
 * Ace on top of the waste once the set is turned (the slice is dealt onto the waste
 * in reverse), so the one card played off that set is a legal foundation move and the
 * cards left on it are fillers. Turn 3's set is all Aces, so each of its cards can go
 * home in turn. A deal mode that turns one card needs no playable card in turn 2's
 * set — nothing is played off it — so that set is a filler too.
 */
function stockFor(tc) {
  const fillers = FILLERS.slice();
  const take = (n) => fillers.splice(0, n);
  const turn1 = take(tc);
  const turn2 = tc > 1 ? [ACES[3], ...take(tc - 1)] : take(1);
  const turn3 = ACES.slice(0, tc);
  return [...turn3, ...turn2, ...turn1];
}

export default function item() {
  // The build's own turn count, the fan after each step of the scenario, and the
  // card the waste should come back to.
  let tc;
  let playedOffSet2; // cards played off turn 2's set: 1, or 0 for a one-card deal
  const visible = { turn1: 0, turn2: 0, played2: 0, turn3: 0, spent3: 0 };
  const wasteLen = { turn3: 0, spent3: 0 };
  let expectedTop = null; // the card left on top of turn 2's set
  let actualTop = null;
  const accepted = [];

  return {
    id: "stock.waste-set-memory",

    // Three turns' worth of cards in the stock and nothing else on the table: the
    // waste starts empty so every set on it is one this run turned.
    async arrange(api) {
      // The stock's contents depend on the deal mode's turn count, so enter play on
      // an empty board first and read the build's own count back before posing it.
      await pose(api, {}, 5);
      tc = (await api.snapshot()).turnCount;
      playedOffSet2 = tc > 1 ? 1 : 0;
      await api.call("setBoard", { stock: stockFor(tc) });
    },

    async act(api) {
      // Turn 1: a set that is never played off, so it stays buried under everything
      // that follows and the waste is never down to a single set.
      await api.call("turnStock");
      await api.advance(BEAT);
      visible.turn1 = wasteVisible(await api.snapshot());

      // Turn 2: the set the check is really about. Its top card goes home, leaving
      // the rest of it on the waste.
      await api.call("turnStock");
      await api.advance(BEAT);
      visible.turn2 = wasteVisible(await api.snapshot());

      for (let i = 0; i < playedOffSet2; i += 1) {
        accepted.push(
          await api.call(
            "move",
            { pile: "waste" },
            { pile: "foundation", index: 0 },
          ),
        );
        await api.advance(BEAT);
      }
      const afterPlay = await api.snapshot();
      visible.played2 = wasteVisible(afterPlay);
      expectedTop = afterPlay.waste[afterPlay.waste.length - 1];

      // Turn 3: a fresh set on top of the partly-played one.
      await api.call("turnStock");
      await api.advance(BEAT);
      const afterTurn3 = await api.snapshot();
      visible.turn3 = wasteVisible(afterTurn3);
      wasteLen.turn3 = afterTurn3.waste.length;

      // Play turn 3's set off entirely, each card home onto a foundation of its own.
      for (let i = 0; i < tc; i += 1) {
        accepted.push(
          await api.call(
            "move",
            { pile: "waste" },
            { pile: "foundation", index: playedOffSet2 + i },
          ),
        );
        await api.advance(BEAT);
      }
      const spent = await api.snapshot();
      visible.spent3 = wasteVisible(spent);
      wasteLen.spent3 = spent.waste.length;
      actualTop = spent.waste[spent.waste.length - 1] ?? null;
    },

    async assert(api, check) {
      check.expectGe("the deal mode turns at least one card", tc, 1);
      for (let i = 0; i < accepted.length; i += 1) {
        check.expectEq(
          `play ${i + 1} off the waste was accepted`,
          accepted[i],
          true,
        );
      }

      // Each turn shows the set it just brought over.
      check.expectEq("turn 1 shows the cards it turned", visible.turn1, tc);
      check.expectEq("turn 2 shows the cards it turned", visible.turn2, tc);
      check.expectEq(
        "playing off turn 2's set leaves the rest of it showing",
        visible.played2,
        tc - playedOffSet2,
      );
      check.expectEq("turn 3 shows the cards it turned", visible.turn3, tc);
      check.expectEq(
        "turn 3 sits on top of what turn 2 left",
        wasteLen.turn3,
        3 * tc - playedOffSet2,
      );

      // The item: turn 3's set is spent, so the waste comes back to what is left of
      // turn 2's set — not to a single squared card, and not to a refilled fan.
      check.expectEq(
        "the waste still holds the cards turn 3 did not take",
        wasteLen.spent3,
        2 * tc - playedOffSet2,
      );
      check.expectEq(
        "with turn 3's set spent, the waste shows what turn 2's set has left",
        visible.spent3,
        tc - playedOffSet2,
      );
      check.expectEq(
        "and the card on top is the one turn 2's set was left with",
        actualTop && `${actualTop.suit} ${actualTop.rank}`,
        expectedTop && `${expectedTop.suit} ${expectedTop.rank}`,
      );
    },
  };
}
