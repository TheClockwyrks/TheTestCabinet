// tableau/no-early-flip — lifting a card off a column does not turn the card
// beneath.
//
// specs/tableau.md: "The turn belongs to the accepted move. Lifting cards off a
// column with the pointer turns nothing while they are in hand, so a lift whose move
// is then refused leaves the card beneath face-down throughout."
// specs/controls.md: a press lifts the card under it and every card below it, and
// the run "leaves the pile it was lifted from as it enters the hand, so that pile
// holds only the cards left behind for as long as the gesture lasts". A drop whose
// leading card's centre lies in no pile's rectangle returns the run to the pile it
// was lifted from.
//
// WHY THE LIFT IS THE INTERESTING MOMENT. While the seven of hearts is in hand its
// column holds one card, face-down, and lying lowest — the very shape that entitles
// a card to turn once a move has been ACCEPTED. A build that turns a column's
// face-down lowest card whenever it finds one, rather than at the end of an accepted
// move, turns it here, and the card is still face-up when the refused gesture puts
// the seven back. The face is read after the press, after every step of the sweep,
// and after the release, so the failure prints WHEN it turned.
//
// WHERE IT IS RELEASED. Over the third column position in the top row, which
// specs/table.md says carries no pile: the leading card's centre lies in none of the
// thirteen drop rectangles, so the gesture is a drop that resolves to nothing and
// the run goes back. That is the "released over no target" this item names, and it
// depends on no rule about what any pile accepts.
//
// THE LIFT IS ASSERTED FIRST, because a build that picked nothing up would leave the
// card beneath covered and the faces this check reads would then be measuring
// nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  card,
  cardById,
  captureReplay,
  cardCenter,
  createHarness,
  down,
  FOUR,
  grabPoint,
  movePointerTo,
  openTable,
  pileTopLeft,
  poseColumn,
  pressAt,
  releaseAt,
  SEVEN,
  type Harness,
  type Point,
} from "../harness";
import { pileText } from "./board";

/** The column the card is lifted off. */
const SOURCE = 3;
/** Its buried card, face-down, and the one face-up card lying below it. */
const BURIED = down(card("clubs", FOUR));
const BURIED_TEXT = "#4C";
const LIFTED = card("hearts", SEVEN);
const LIFTED_TEXT = "7H";
/** The lifted card's row in that column, counted from the bottom. */
const LIFTED_ROW = 1;
/** The column as it stood, and as it must stand again once the run is back. */
const COLUMN_TEXT = [BURIED_TEXT, LIFTED_TEXT];

/**
 * Where the run is released: the centre of a card drawn at the third column
 * position of the TOP ROW, which specs/table.md says carries no pile. The press
 * lands on the lifted card's own centre, so the run keeps a zero offset and its
 * leading card's centre is exactly where the pointer is.
 */
const NO_PILE_TOP_LEFT = {
  x: pileTopLeft("tableau", 2).x,
  y: pileTopLeft("stock").y,
};
const DROP_POINT = cardCenter(NO_PILE_TOP_LEFT.x, NO_PILE_TOP_LEFT.y);

/** The sweep: how many pointer moves carry the run, and the frames between them. */
const SWEEP_STEPS = 8;
const FRAMES_PER_STEP = 3;
/** Frames held at each end of the gesture, so the recording opens and closes on it. */
const FRAMES_AT_REST = 6;

/** The one card the press must lift: the face-up card, on its own. */
const HELD_CARDS = [LIFTED_TEXT];

/**
 * The faces the card beneath must read: one reading after the press, one after each
 * pointer move, one after the release, every one of them face-down.
 */
const STAYS_FACE_DOWN = Array.from(
  { length: SWEEP_STEPS + 2 },
  () => false as boolean | undefined,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the card beneath a lifted card face-down throughout the gesture", async () => {
  openTable(h);
  const [buriedId] = poseColumn(h, SOURCE, [BURIED, LIFTED]);
  const grab = grabPoint(h.snapshot(), SOURCE, LIFTED_ROW);

  /** The buried card's face, read wherever the gesture has got to. */
  const buriedFace = (): boolean | undefined =>
    cardById(h.snapshot(), buriedId)?.faceUp;

  let held: string[] = [];
  const faces: (boolean | undefined)[] = [];

  await captureReplay(h, "lift", async () => {
    pressAt(h, grab.x, grab.y);
    await h.advance(FRAMES_AT_REST);
    held = pileText(h.snapshot().drag?.cards ?? []);
    faces.push(buriedFace());

    for (let step = 1; step <= SWEEP_STEPS; step += 1) {
      const t = step / SWEEP_STEPS;
      const at: Point = {
        x: grab.x + (DROP_POINT.x - grab.x) * t,
        y: grab.y + (DROP_POINT.y - grab.y) * t,
      };
      movePointerTo(h, at.x, at.y);
      await h.advance(FRAMES_PER_STEP);
      faces.push(buriedFace());
    }

    releaseAt(h, DROP_POINT.x, DROP_POINT.y);
    await h.advance(FRAMES_AT_REST);
    faces.push(buriedFace());
  });

  const after = h.snapshot();

  assertDeepEqual(
    held,
    HELD_CARDS,
    `the run in hand after the press on ${LIFTED_TEXT}, the lowest card of ` +
      `column ${SOURCE} (specs/controls.md)`,
  );
  assertDeepEqual(
    faces,
    STAYS_FACE_DOWN,
    `the face of the card beneath, read after the press, after each of the ` +
      `${SWEEP_STEPS} pointer moves, and after the release: it stays ` +
      "face-down throughout (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[SOURCE]),
    COLUMN_TEXT,
    `column ${SOURCE} once the refused gesture is over: the lifted card is ` +
      "back where it came from and the card beneath is still face-down " +
      "(specs/tableau.md)",
  );
});
