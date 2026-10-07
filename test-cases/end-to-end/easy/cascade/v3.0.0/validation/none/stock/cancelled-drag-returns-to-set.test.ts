// stock/cancelled-drag-returns-to-set — a waste card lifted and released over no
// pile is back on the waste, and the set memory is exactly as it was.
//
// `specs/stock.md`: "A lift leaves the set memory untouched. The set a lifted
// card came from keeps its count for as long as the card is in hand, and a set's
// count falls only when its card leaves the waste for good. So a card lifted off
// the waste and returned to it ... rejoins the set it came from and finds the
// memory exactly as it was." `specs/controls.md` fixes the gesture: a release
// whose leading card's centre lies "in no pile's rectangle" returns the run to
// the pile it was lifted from.
//
// WHAT WOULD GO WRONG WITHOUT THE RULE. A build that takes the card off its set
// on the LIFT and puts it back on the RETURN can only be told from a correct one
// while the card is in hand, and the specification's own sentence is about the
// state the gesture ends in — so that is what is read here: the card back on the
// waste, `wasteSets` as it was, `wasteVisibleCount` as it was. A build that
// decremented the set and did not restore it shows a waste holding a card it
// will not let anyone play, which is precisely the closed state
// `specs/stock.md` describes and nothing a player could recover from.
//
// THE WASTE HOLDS ONE CARD ON ONE SET. That is the smallest waste that shows
// anything, and it is the one shape whose top card is drawn AT THE WASTE ANCHOR
// under both deal modes — `specs/table.md` fans the shown cards from that anchor,
// so a single shown card sits on it whatever the mode. A common point can
// therefore name the press point without naming a fan pitch, which is a
// per-variant figure (`draw-three/waste-fans-shown-set` owns it).
//
// THE RELEASE LANDS ON NO PILE. `specs/table.md` leaves the third column
// position of the top row, `x = 468`, carrying no pile, and the drop rectangles
// of the two piles either side of it stop well clear: the waste's ends at `446`
// and foundation 0's begins at `590`. The leading card is carried until its
// centre sits there, which is `dragRunTo`'s whole job. The two anchors are `122`
// apart, far beyond `DRAG_THRESHOLD` (`5`), so the gesture is a drop — and
// `specs/controls.md` has a click return a held run to its own pile too, so the
// state this point reads is the same either way.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { TOP_ROW_GAP_X, TOP_ROW_Y, WASTE_X } from "../constants";
import {
  cardCenter,
  captureStill,
  cards,
  createHarness,
  dragRunTo,
  openTable,
  poseWaste,
  topOf,
  type Harness,
} from "../harness";

/** The waste: one card on one set, so the shown card sits at the waste anchor. */
const WASTE = ["6H"];
const WASTE_SETS = [1];

/** Where the press lands: the centre of the card the waste is showing. */
const PRESS = cardCenter(WASTE_X, TOP_ROW_Y);

/** Where the lifted card is carried to: the top row's empty third position. */
const NOWHERE = cardCenter(TOP_ROW_GAP_X, TOP_ROW_Y);

/** One frame, so the still carries the waste the gesture left behind. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns the lifted card to the waste with its set memory unchanged", async () => {
  await openTable(h);
  const [liftedId] = await poseWaste(h, cards(...WASTE), WASTE_SETS);

  // `dragRunTo` fails the point if the press lifted nothing, which is the one
  // way this scenario can fail to happen at all.
  await dragRunTo(h, PRESS.x, PRESS.y, NOWHERE.x, NOWHERE.y);
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "returned");

  const after = await h.snapshot();
  assertNull(
    after.drag,
    "the run in hand after the release — the gesture ended, so nothing is held",
  );
  assertEqual(
    topOf(after.waste)?.id,
    liftedId,
    `the waste's card (id ${liftedId}) after the release — specs/controls.md: ` +
      "a run released with its leading card's centre in no pile's rectangle " +
      "returns to the pile it was lifted from",
  );
  assertDeepEqual(
    after.wasteSets,
    WASTE_SETS,
    "the waste's set memory after the cancelled drag, oldest set first — " +
      "specs/stock.md: the card rejoins the set it came from and finds the " +
      "memory exactly as it was",
  );
  assertEqual(
    after.wasteVisibleCount,
    WASTE_SETS[WASTE_SETS.length - 1],
    "the cards the waste is showing after the cancelled drag — the set the " +
      "card came from kept its count, so the waste shows what it showed " +
      "(specs/stock.md)",
  );
});
