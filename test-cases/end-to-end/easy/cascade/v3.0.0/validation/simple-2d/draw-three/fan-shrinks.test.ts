// draw-three/fan-shrinks — the fan counts down within its set and never refills.
//
// THE RULE. specs/stock.md: the waste "shows the cards it holds from the newest set
// that still holds any", and "playing the top card off the waste leaves its set one
// card smaller". specs/table.md fans exactly those cards from the waste anchor and
// squares "every other card the waste holds" away beneath them. So a shown set of
// three fans three cards, then two, then one as its cards are played off, and the
// cards of the set turned before it stay squared away underneath: the fan never
// counts back up and never pulls a card up from beneath.
//
// THE POSE IS THE ONE THAT SEPARATES THE TWO WRONG MODELS. Five cards on the waste
// in two sets, two buried and three shown, so the pile still holds cards under the
// set being played off. A build that refills its fan from whatever the waste holds
// keeps three cards fanned after each play; a build that follows the rule drops to
// two and then to one while the buried pair stays squared at the anchor. With no
// buried cards the two builds would be indistinguishable.
//
// WHAT IS READ. How many positions the waste drew a card-sized shape at, after each
// play, and that the leftmost of them is the waste anchor the fan begins at
// (specs/table.md). Three positions are occupied, then two, then one. The leftmost
// carries the squared cards as well as the fan's oldest shown card, so it is occupied
// throughout; what the reading turns on is the count falling by one with each card
// played off and never rising. Where the fan puts its cards is
// `draw-three/waste-fans-shown-set`, so a build that fans at the wrong pitch is
// docked there and counted honestly here.
//
// THE PLAYS ARE THE GAME'S OWN. Each is a `move` of the waste's top card onto the
// foundation of its suit, so the fan shrinks because the game played a card off it.
// Each move's verdict is asserted, because a build that refused a legal play never
// reached the state this point is about.
//
// The counts the state reports are `stock.set-shrinks-on-play`; this point decides
// what the table draws.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_W, FOUNDATION_X, TOP_ROW_Y, WASTE_X } from "../../src/constants";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  CARD_BOX_TOLERANCE,
  cardBoxes,
  captureReplay,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  poseFoundation,
  poseWaste,
  type DrawCall,
  type Harness,
} from "../harness";

/** The waste, bottom card first: two buried by an earlier turn, three shown. */
const WASTE = ["9C", "4S", "2S", "2H", "2D"];

/** The two sets, oldest first: the buried pair, then the three that are shown. */
const SETS = [2, 3];

/**
 * The plays, in order: the waste's top card and the foundation its suit is on.
 * Each is one rank above that foundation's Ace, so each is legal
 * (specs/foundations.md).
 */
const PLAYS = [
  { card: "2D", foundation: 2 },
  { card: "2H", foundation: 1 },
];

/** The Ace each foundation is started with, in foundation order. */
const ACES = ["spades", "hearts", "diamonds"] as const;

/** Cards on the set the waste shows when the scenario opens. */
const SHOWN_SET = SETS[SETS.length - 1];

/** The band the waste's own cards are read in, as in `waste-fans-shown-set`. */
const BAND_LEFT = WASTE_X - CARD_W;
const BAND_RIGHT = FOUNDATION_X[0];

/** The harness's allowance for the unit a build loses insetting a stroke. */
const PLACEMENT_TOLERANCE = CARD_BOX_TOLERANCE;

/** The distinct positions the waste drew a card-sized shape at, left to right. */
function fanAnchors(h: Harness, calls: readonly DrawCall[]): number[] {
  const drawn = cardBoxes(drawnBoxes(h, calls)).filter(
    (box) =>
      Math.abs(box.y - TOP_ROW_Y) <= PLACEMENT_TOLERANCE &&
      box.x >= BAND_LEFT &&
      box.x < BAND_RIGHT,
  );
  const anchors: number[] = [];
  for (const box of drawn) {
    if (anchors.every((x) => Math.abs(box.x - x) > PLACEMENT_TOLERANCE)) {
      anchors.push(box.x);
    }
  }
  return anchors.sort((a, b) => a - b).map((x) => Math.round(x));
}

/**
 * Frames each state is held for while the recording runs.
 *
 * Nothing is read from them and no threshold rests on them: the readings are taken
 * on the frame each state is reached, and this is what gives the reviewer's player
 * a moment on each of them rather than three frames of a flicker. At the harness's
 * 240 Hz step it is an eighth of a second apiece, and the whole recording stays
 * inside the recorder's own frame budget.
 */
const HOLD_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fans three, then two, then one, and never refills from beneath", async () => {
  openTable(h);
  for (const [index, suit] of ACES.entries()) poseFoundation(h, index, suit, 1);
  poseWaste(h, WASTE, SETS);

  const drive = await captureReplay(h, "fan", async () => {
    const anchors: number[][] = [fanAnchors(h, await drawFrame(h))];
    const verdicts: boolean[] = [];
    await h.advance(HOLD_FRAMES);
    for (const play of PLAYS) {
      const top = h.snapshot().waste.length - 1;
      verdicts.push(
        h.debug.move("waste", 0, top, "foundation", play.foundation),
      );
      anchors.push(fanAnchors(h, await drawFrame(h)));
      await h.advance(HOLD_FRAMES);
    }
    return { anchors, verdicts };
  });

  for (const [index, play] of PLAYS.entries()) {
    assertEqual(
      drive.verdicts[index],
      true,
      `the verdict on playing the ${play.card} home from the waste, a legal ` +
        `move onto foundation ${play.foundation} (specs/foundations.md)`,
    );
  }

  for (const [index, anchors] of drive.anchors.entries()) {
    const shown = SHOWN_SET - index;
    assertLength(
      anchors,
      shown,
      `positions the waste drew a card at with ${shown} card` +
        `${shown === 1 ? "" : "s"} left on its shown set: the set fans one ` +
        "card per position and the cards beneath it are squared away at the " +
        "anchor (specs/table.md)",
    );
    assertBetween(
      anchors[0] ?? Number.NaN,
      WASTE_X - PLACEMENT_TOLERANCE,
      WASTE_X + PLACEMENT_TOLERANCE,
      `the leftmost position the waste drew a card at with ${shown} card` +
        `${shown === 1 ? "" : "s"} shown: the fan begins at the waste anchor ` +
        "(specs/table.md)",
    );
  }
});
