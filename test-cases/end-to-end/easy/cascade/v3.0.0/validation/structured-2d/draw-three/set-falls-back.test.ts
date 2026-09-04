// Cascade — draw-three/set-falls-back: the waste remembers what each turn left it with.
//
// specs/stock.md, The waste's set memory: "The waste keeps the cards of each turn
// together as a set and remembers its sets in the order they were turned, oldest
// first. ... The waste shows the cards it holds from the newest set that still
// holds any ... Playing the top card off the waste leaves its set one card
// smaller, and a set played off entirely leaves the memory, so the waste falls
// back to what is left of the set turned before it."
//
// THIS IS THE STATE THE RULE EXISTS FOR, and it is reachable only in Draw Three:
// a set played off ENTIRELY, standing over a set that was played off only in
// part. The waste then owes the earlier set's two remaining cards, and nothing
// but the rule above says so.
//
// The scenario is driven through the build's own stock and move code rather than
// posed, because what is under test is the memory the build KEEPS as it plays,
// not what it reports about a memory this check handed it:
//
//   turn                      set one, three cards, never played off
//   turn                      set two, three cards
//   play one card home        set two is left holding two
//   turn                      set three, three cards
//   play all three home       set three is played off entirely
//
// Five cards are still on the waste at the end, which is what makes every wrong
// model read as its own number. A build that remembers only the LAST turn's count
// shows three, or nothing at all; a build that refills its fan from the cards
// beneath shows three; a build that shows whatever the waste holds shows five.
// The rule shows TWO. None of them is clamped into the right answer by the size
// of the pile, which a scenario with fewer cards left would do.
//
// And the count alone is not enough: a build that showed two of the wrong cards
// would pass it. So the top card is checked BY IDENTITY too — it must be the card
// the second turn was left with — and the pair the waste shows must be that
// turn's two cards, in the order it turned them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  captureReplay,
  card,
  createHarness,
  EIGHT,
  FIVE,
  openTable,
  poseStock,
  QUEEN,
  SEVEN,
  SIX,
  wasteShown,
  type Harness,
} from "../harness";
import { TURN_COUNT } from "./constants";

/**
 * The nine cards the three turns take, in the order they are turned.
 *
 * The last four are the four Aces, because those are the cards this drive plays
 * home: specs/foundations.md accepts an Ace on an empty foundation whatever its
 * suit, so each play is the game's own move rather than a posed removal. The
 * first five stay on the waste, and the fifth — the Queen of hearts, the only
 * Queen in the deal — is the card the second turn is left with and the one the
 * waste must fall back to showing.
 *
 *   index 0,1,2   turn one    a set never played off
 *   index 3,4     turn two    the two cards it is left with
 *   index 5       turn two    played home, leaving that set holding two
 *   index 6,7,8   turn three  all three played home, emptying that set
 */
const TURNED = [
  card("spades", FIVE),
  card("hearts", SIX),
  card("diamonds", SEVEN),
  card("clubs", EIGHT),
  card("hearts", QUEEN),
  card("spades", ACE),
  card("hearts", ACE),
  card("diamonds", ACE),
  card("clubs", ACE),
];

/** The set memory the rule leaves behind: turn one whole, turn two short a card. */
const EXPECTED_SETS = [3, 2];

/** Cards still on the waste when the reading is taken. */
const EXPECTED_WASTE = 5;

/** The cards the waste must then show: the two the second turn was left with. */
const EXPECTED_VISIBLE = 2;

/**
 * Frames held between the steps of the drive.
 *
 * Presentation only, so the recording reads as a game being played rather than as
 * a jump cut. Nothing is measured across them and nothing on this table moves on
 * its own, so they change no verdict.
 */
const HOLD_FRAMES = 18; // 0.3 s at the suite's 60 Hz

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("falls back to the two cards the second turn was left with", async () => {
  openTable(h);
  // Bottom card first, so the LAST card posed is the one the first turn takes.
  const posed = poseStock(h, [...TURNED].reverse());
  /** The id of the card turned `nth`, counted from the first turn's first card. */
  const turnedId = (nth: number): number => posed[TURNED.length - 1 - nth];

  /** The waste's top card, sent home by the game's own move rules. */
  const playTopHome = (foundation: number): void => {
    const waste = h.snapshot().waste;
    const top = waste[waste.length - 1];
    const accepted = h.debug.move(
      "waste",
      0,
      waste.length - 1,
      "foundation",
      foundation,
    );
    assertEqual(
      accepted,
      true,
      `move() to accept the ${top?.suit} Ace onto empty foundation ` +
        `${foundation} (specs/foundations.md)`,
    );
  };

  await captureReplay(h, "fallback", async () => {
    h.debug.turnStock(); // set one
    await h.advance(HOLD_FRAMES);

    h.debug.turnStock(); // set two
    await h.advance(HOLD_FRAMES);
    playTopHome(0); // set two is left holding two
    await h.advance(HOLD_FRAMES);

    h.debug.turnStock(); // set three
    await h.advance(HOLD_FRAMES);
    for (let played = 0; played < TURN_COUNT; played += 1) {
      playTopHome(played + 1); // set three, played off entirely
      await h.advance(HOLD_FRAMES);
    }

    await h.advance(HOLD_FRAMES);
  });

  const snapshot = h.snapshot();

  // The waste is still five cards deep, so nothing below forces the answer.
  assertEqual(
    snapshot.waste.length,
    EXPECTED_WASTE,
    "cards still on the waste when its newest set was played off",
  );
  assertDeepEqual(
    snapshot.wasteSets,
    EXPECTED_SETS,
    "the sets the waste remembers, oldest first",
  );
  assertEqual(
    snapshot.wasteVisibleCount,
    EXPECTED_VISIBLE,
    "cards the waste shows once its newest set has been played off",
  );

  // By identity as well as by count: the pair the SECOND turn was left with, in
  // the order it turned them, and its later card on top.
  assertDeepEqual(
    wasteShown(snapshot).map((shown) => shown.id),
    [turnedId(3), turnedId(4)],
    "the cards the waste shows, bottom-most first",
  );
  assertEqual(
    snapshot.waste[snapshot.waste.length - 1].id,
    turnedId(4),
    "the waste's top card",
  );
});
