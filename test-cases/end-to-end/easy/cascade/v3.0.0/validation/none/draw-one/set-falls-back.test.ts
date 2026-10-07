// draw-one/set-falls-back — a set played off entirely leaves the memory, and the
// waste falls back to what the turn before it left: the earlier turn's card shows
// again, by identity as well as by count.
//
// `specs/stock.md` fixes it: "The waste shows the cards it holds from the newest
// set that still holds any … Playing the top card off the waste leaves its set
// one card smaller, and a set played off entirely leaves the memory, so the waste
// falls back to what is left of the set turned before it." Under a turn count of
// `1` a set holds one card, so playing the shown card empties its set and the
// fallback is the whole of the rule. `specs/instrumentation.md` fixes the
// reading — "`wasteVisibleCount` | The newest entry of `wasteSets`, and `0` when
// `wasteSets` is empty" — and that "A card keeps its id … across every move,
// turn", which is what makes the identity half assertable.
//
// THE POSE IS SIZED SO EVERY WRONG MODEL READS SOMETHING DIFFERENT. The waste is
// left holding THREE cards after the play, and the card that must show is the
// middle one, so nothing is clamped into the right answer by the size of the
// pile:
//
//   - the rule                          shows the `9S`, the earlier turn's card
//   - a counter that remembers only the last turn   shows nothing, count `0`
//   - a memory that keeps its emptied set           shows nothing, count `0`
//   - "the waste shows its bottom card"             shows the `2C`
//   - "the waste refills from what it holds"        shows more than one card
//
// Two real turns make the two sets the rule is about, and the cards beneath them
// were put there by earlier passes, which is the ordinary state of a waste part
// way through a game. `stock/set-shrinks-on-play` decides the other direction of
// the same rule — a set that is only made smaller — and
// `draw-three/set-falls-back` decides it over sets of more than one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseFoundation,
  poseStock,
  poseWaste,
  wasteTop,
  type Harness,
} from "../harness";
import { TURN_COUNT } from "./constants";

/**
 * The foundation the played card goes home on, and how far up it stands.
 *
 * Hearts on foundation `2` rather than on a slot a suit order would predict:
 * `specs/foundations.md` ties no suit to a slot, and the point being decided here
 * is the waste's memory, not which foundation took the card.
 */
const HEARTS_FOUNDATION = 2;
const HEARTS_UP_TO = 5;

/**
 * The cards earlier passes left on the waste, bottom card first, each its own
 * set. They are what the waste is still holding when the reading is taken, and
 * the `2C` at the bottom is what a build that shows the wrong end reaches for.
 */
const EARLIER = ["2C", "7D"] as const;

/**
 * The stock the two turns are taken from, bottom card first, so the `9S` is
 * turned first and the `6H` second — leaving the `6H` showing, the card that then
 * goes home, and the `9S` as the card the earlier turn left.
 *
 * The `4D` is never turned; it is there so neither turn empties the stock and no
 * recycle is anywhere near this scenario.
 */
const STOCK = ["4D", "6H", "9S"] as const;

/** The card the second turn brings over, and the one that is played home. */
const PLAYED = "6H";
/** The card the first turn left, which must show once the `6H` has gone. */
const FALLBACK = "9S";

/** One frame, so the still shows the card the waste fell back to. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the earlier turn's card once the newer one is played home", async () => {
  await openTable(h);
  await poseFoundation(h, HEARTS_FOUNDATION, "hearts", HEARTS_UP_TO);
  await poseWaste(
    h,
    cards(...EARLIER),
    EARLIER.map(() => TURN_COUNT),
  );
  const stockIds = await poseStock(h, cards(...STOCK));
  const fallbackId = stockIds[STOCK.indexOf(FALLBACK)];
  const playedId = stockIds[STOCK.indexOf(PLAYED)];

  await h.debug.turnStock();
  await h.debug.turnStock();

  // The card about to be played really is the one the second turn left showing,
  // so what follows is the fallback rather than some other card leaving.
  const turned = await h.snapshot();
  assertEqual(
    wasteTop(turned)?.id,
    playedId,
    "the card the waste shows before it is played home",
  );

  const went = await h.debug.move(
    "waste",
    0,
    turned.waste.length - 1,
    "foundation",
    HEARTS_FOUNDATION,
  );
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "waste");

  assertEqual(
    went,
    true,
    "the verdict the hearts foundation gave the card played off the waste",
  );

  const after = await h.snapshot();
  assertEqual(
    after.wasteVisibleCount,
    TURN_COUNT,
    "the cards the waste shows once the newer set has been played off",
  );
  assertEqual(
    wasteTop(after)?.id,
    fallbackId,
    "the card the waste falls back to showing",
  );
  assertEqual(
    after.waste.length,
    EARLIER.length + 1,
    "the cards the waste is still holding behind it",
  );
});
