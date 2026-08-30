// tableau/no-early-flip — a card in hand has not been played, so nothing turns
// beneath it.
//
// specs/tableau.md: "the turn belongs to the accepted move. Lifting cards off a
// column with the pointer turns nothing while they are in hand, so a lift whose move
// is then refused leaves the card beneath face-down throughout."
// specs/controls.md: the run "leaves the pile it was lifted from as it enters the
// hand, so that pile holds only the cards left behind for as long as the gesture
// lasts", and a release in no pile's rectangle returns the run to the pile it was
// lifted from.
//
// THE WRONG MODEL THIS NAMES. A build that turns a column's lowest face-down card
// whenever it notices one — each frame, or on every change to a column — rather than
// on an accepted move turns the buried card the instant the card above it is picked
// up. The column is posed so that state is REACHED: one buried card with the
// column's only face-up card below it, so the moment the face-up card enters the hand
// the column's lowest card is face-down and the wrong model fires.
//
// READ AT THREE MOMENTS, because "throughout" is a span and not an instant: with the
// run just lifted, after it has been carried across the table over many frames, and
// after the release that gave it back. The gesture is driven through the ENGINE's own
// pointer and the frames between the samples are really run, so a build that turns
// the card in its update rather than in its input handler is caught by the middle
// reading.
//
// THE RUN IS RELEASED WHERE NO PILE ANSWERS. specs/table.md leaves the third column
// position of the top row, `x = 468`, carrying no pile, and the top row's rectangles
// are one card in size, so the center of a card released there lies in none of the
// thirteen rectangles and the drop is refused for want of a target rather than by any
// pile's own rule.
//
// THE LIFT IS READ FIRST. A build whose press lifts nothing never reaches this rule
// at all, and a check that only read the card's face would pass it; so the run in
// hand is read before anything is concluded from the face beneath it.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_H, CARD_W, COLUMN_X, TOP_ROW_Y } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  cardOf,
  cardSpec,
  createHarness,
  framesFor,
  openTable,
  poseColumn,
  pressPoint,
  type Harness,
} from "../harness";

/** The column the card is lifted from. */
const COLUMN = 2;
/** The buried card, which must stay face-down for the whole gesture. */
const BURIED = "#7C";
/** The column's only face-up card, the one the pointer lifts. */
const LIFTED = "9H";

/**
 * Where the card is carried to: the center of the top row's empty third position,
 * which specs/table.md fixes as carrying no pile, so no drop rectangle contains it.
 */
const DEAD_SPOT = {
  x: COLUMN_X[2] + CARD_W / 2,
  y: TOP_ROW_Y + CARD_H / 2,
};

// The three spans below pace the GESTURE; no figure of the specification is read
// off them. specs/tableau.md states the rule as holding for as long as the cards are
// in hand, with no duration attached, so what these choose is only how many frames of
// real simulation run inside that span — enough that a build turning the card in its
// per-frame update, rather than in the move it answered, has had hundreds of frames
// to do it in, and enough that the recording is watchable.

/** How long the card is held still after the press, in frames. */
const HOLD_FRAMES = framesFor(0.15);
/** How the travel is broken up: this many moves, this many frames apart. */
const TRAVEL_STEPS = 8;
const TRAVEL_FRAMES = framesFor(0.03);
/** How long the game runs on after the release. */
const SETTLE_FRAMES = framesFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the card beneath a lifted card face-down throughout the gesture", async () => {
  openTable(h);
  const [buriedId] = poseColumn(h, COLUMN, [BURIED, LIFTED]);
  const from = pressPoint(h.snapshot(), "tableau", COLUMN, 1);

  const seen = await captureReplay(h, "lift", async () => {
    h.pointer("pointerdown", from.x, from.y);
    await h.advance(HOLD_FRAMES);
    const held = h.snapshot();

    for (let step = 1; step <= TRAVEL_STEPS; step += 1) {
      const t = step / TRAVEL_STEPS;
      h.pointer(
        "pointermove",
        from.x + (DEAD_SPOT.x - from.x) * t,
        from.y + (DEAD_SPOT.y - from.y) * t,
      );
      await h.advance(TRAVEL_FRAMES);
    }
    const carried = h.snapshot();

    h.pointer("pointerup", DEAD_SPOT.x, DEAD_SPOT.y);
    await h.advance(SETTLE_FRAMES);
    return { held, carried, returned: h.snapshot() };
  });

  assertDeepEqual(
    (seen.held.drag?.cards ?? []).map(cardSpec),
    [LIFTED],
    `the run in hand after pressing ${LIFTED}, the column's lowest card: a ` +
      "press on a face-up column card lifts it (specs/controls.md)",
  );
  assertEqual(
    cardOf(seen.held, buriedId).faceUp,
    false,
    `the face of ${BURIED} with ${LIFTED} just lifted off it: lifting turns ` +
      "nothing while the card is in hand (specs/tableau.md)",
  );
  assertEqual(
    cardOf(seen.carried, buriedId).faceUp,
    false,
    `the face of ${BURIED} while ${LIFTED} is carried across the table: the ` +
      "turn belongs to an accepted move, and no move has been accepted " +
      "(specs/tableau.md)",
  );
  assertEqual(
    cardOf(seen.returned, buriedId).faceUp,
    false,
    `the face of ${BURIED} after ${LIFTED} was released over no pile and ` +
      "returned to the column: the lift's move was refused, so nothing turned " +
      "(specs/tableau.md)",
  );
});
