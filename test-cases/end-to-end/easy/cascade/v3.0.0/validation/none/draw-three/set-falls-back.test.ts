// draw-three/set-falls-back — the waste falls back to what the earlier turn left.
//
// THE RULE. `specs/stock.md`: the waste "keeps the cards of each turn together as
// a set and remembers its sets in the order they were turned", it "shows the cards
// it holds from the newest set that still holds any", and "a set played off
// entirely leaves the memory, so the waste falls back to what is left of the set
// turned before it". So a set of three played off over a set that has already lost
// one card leaves the waste showing that earlier set's remaining two cards, with
// the card it was left with on top.
//
// THIS IS THE STATE THE RULE EXISTS FOR, and the scenario is chosen so that every
// wrong model reads as a different number. Three turns are made, the second's top
// card is played home, and the third's three cards are all played home:
//
//   turn one    a set of three, never played off, buried at the bottom
//   turn two    a set of three, one card played home, so it holds two
//   turn three  a set of three, all three played home, so it leaves the memory
//
// The waste still holds five cards at the end, so the size of the pile clamps
// nothing: `2` is the rule, `1` is a build counting only the cards left from the
// last turn, `3` is a build refilling its fan from the cards buried beneath, and
// `5` is a build showing the whole pile.
//
// IT IS DRIVEN THROUGH THE BUILD'S OWN STOCK CODE, not through a posed waste. The
// set memory this point reads is the memory the build's own turns and plays built,
// which is the only way to decide that its turns and its plays maintain it. Every
// verdict is asserted, because a build that refused a legal play never reached the
// state the reading is about.
//
// THE POSE. Four foundations, each holding the Ace of its own suit, and nine
// face-down cards on the stock arranged so that each card played home is the `2`
// of a suit already started. Every other pile is empty, so nothing the game holds
// is outside what this point concerns.
//
// The set memory's other rules are the common `stock` group's:
// `stock.turn-starts-a-set`, `stock.set-shrinks-on-play` and
// `stock.recycle-clears-sets`. This point decides the fallback alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertDefined,
} from "../assert";
import {
  card,
  cardKey,
  captureReplay,
  createHarness,
  faceDown,
  openTable,
  poseFoundation,
  poseStock,
  topOf,
  type Harness,
} from "../harness";

/** The Ace each foundation is started with, in foundation order. */
const ACES = ["spades", "hearts", "diamonds", "clubs"] as const;

/**
 * The stock, bottom card first, face-down as a card on the stock is
 * (`specs/deal.md`).
 *
 * A turn takes from the top, so the last three are the first turn's set, the three
 * before them the second's, and the first three the third's. The `2` of each suit
 * sits where the card it is played home from lands.
 */
const STOCK = [
  // The third turn's set, played off entirely: taken 2H, 2D, 2C in that order.
  "2H",
  "2D",
  "2C",
  // The second turn's set: its top card 2S is played home, leaving 9C and 8D.
  "2S",
  "8D",
  "9C",
  // The first turn's set, never played off.
  "3H",
  "4C",
  "5D",
];

/** The plays, in order: each the waste's top card, onto the foundation of its suit. */
const PLAYS = [
  { after: 2, card: "2S", foundation: 0 },
  { after: 3, card: "2H", foundation: 1 },
  { after: 3, card: "2D", foundation: 2 },
  { after: 3, card: "2C", foundation: 3 },
];

/** How many turns the scenario makes. */
const TURNS = 3;

/** The card the second turn was left with, which the waste falls back to showing. */
const FALLBACK_TOP = "8D";

/** What the waste shows once the newest set has been played off entirely. */
const SHOWN_AFTER = 2;

/** The cards still on the waste then: the first turn's three and the second's two. */
const HELD_AFTER = 5;

/** The set memory then, oldest first: the untouched three and the shrunken two. */
const SETS_AFTER = [3, 2];

/**
 * Frames each state is held for while the recording runs.
 *
 * Nothing is read from them and no threshold rests on them: the readings are taken
 * from the state each turn and play left, and this is what gives the reviewer's
 * player a moment on each of them rather than a flicker. At the harness's 240 Hz
 * step it is an eighth of a second apiece, and the whole recording stays inside the
 * recorder's own frame budget.
 */
const HOLD_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the two cards the second turn was left with", async () => {
  await openTable(h);
  for (const [index, suit] of ACES.entries()) {
    await poseFoundation(h, index, suit, 1);
  }
  await poseStock(h, faceDown(...STOCK));

  const verdicts = await captureReplay(h, "fallback", async () => {
    const played: boolean[] = [];
    let turned = 0;
    for (const play of PLAYS) {
      while (turned < play.after && turned < TURNS) {
        await h.debug.turnStock();
        turned += 1;
        await h.advance(HOLD_FRAMES);
      }
      const top = (await h.snapshot()).waste.length - 1;
      played.push(
        await h.debug.move("waste", 0, top, "foundation", play.foundation),
      );
      await h.advance(HOLD_FRAMES);
    }
    return played;
  });

  for (const [index, play] of PLAYS.entries()) {
    assertEqual(
      verdicts[index],
      true,
      `the verdict on playing the ${play.card} home from the waste after ` +
        `${play.after} turns, a legal move onto foundation ${play.foundation} ` +
        "(specs/foundations.md)",
    );
  }

  const after = await h.snapshot();
  assertEqual(
    after.wasteVisibleCount,
    SHOWN_AFTER,
    "cards the waste shows once its newest set has been played off entirely: " +
      "it falls back to what is left of the set turned before it " +
      "(specs/stock.md)",
  );
  assertLength(
    after.waste,
    HELD_AFTER,
    "cards still on the waste, which the fallback does not touch " +
      "(specs/stock.md)",
  );
  const top = topOf(after.waste);
  assertDefined(
    top,
    "a card on top of the waste, which still holds the two sets beneath the " +
      "one played off (specs/stock.md)",
  );
  assertEqual(
    top === undefined ? undefined : cardKey(top),
    cardKey(card(FALLBACK_TOP)),
    "the waste's top card, which is the last card still on the set it fell " +
      "back to (specs/stock.md)",
  );
  assertDeepEqual(
    after.wasteSets,
    SETS_AFTER,
    "the waste's set memory, oldest first: the first turn's three cards and " +
      "the two the second turn was left with, the third turn's set having " +
      "left the memory (specs/stock.md)",
  );
});
