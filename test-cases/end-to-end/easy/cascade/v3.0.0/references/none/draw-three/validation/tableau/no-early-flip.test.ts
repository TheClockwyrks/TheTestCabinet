// tableau/no-early-flip — the turn belongs to the accepted move, not to the lift.
//
// THE RULE. `specs/tableau.md`: "The turn belongs to the accepted move. Lifting
// cards off a column with the pointer turns nothing while they are in hand, so a
// lift whose move is then refused leaves the card beneath face-down throughout."
//
// WHY THE STATE IS REACHABLE AT ALL, AND WHY IT NEEDS ITS OWN POINT.
// `specs/controls.md` says the run "leaves the pile it was lifted from as it
// enters the hand, so that pile holds only the cards left behind for as long as
// the gesture lasts". So between the press and the release the column genuinely
// holds a face-down card as its lowest card, and a build that hangs the turn on
// "this column's lowest card is face-down" — a check run each frame, or run when
// the run is detached — turns it the moment the player picks the card up. The
// player then sees a card they never earned, and putting the run back does not
// put the card face-down again. Every other point in this group drives `move`,
// which never passes through that state, so this is the only place the defect
// shows.
//
// THE GESTURE IS A DROP THAT LANDS NOWHERE, so the lift is undone by the rules
// rather than by the check: the run's leading card is carried to the 22-unit gap
// between columns 0 and 1, which `specs/table.md` gives to no pile, and released
// there. `specs/controls.md` returns a run whose leading card's center lies in no
// drop rectangle. The release is far more than `DRAG_THRESHOLD` (`5`) from the
// press, so the gesture is a drop rather than a click.
//
// THE READING IS TAKEN FOUR TIMES — after the press, twice while the run is
// carried, and after the release — because "throughout" is the word the rule
// uses. A build that turns the card on the press and a build that turns it on
// the release are different defects, and the sample that fails names which.
//
// WHERE THE RUN GOES AFTER THE RELEASE is `handling/release-elsewhere-returns`,
// and this point reads none of it.
//
// `autoFlip` is left ON at its reset default. That is the point: the faculty is
// live, and no accepted move has asked it for anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { CARD_W, COLUMN_X, DRAG_THRESHOLD } from "../constants";
import {
  captureReplay,
  card,
  cardCenter,
  columnCardTopLeft,
  createHarness,
  faceDown,
  openTable,
  poseColumn,
  requireCard,
  type Harness,
} from "../harness";

/** The column the card is lifted off. */
const COLUMN = 0;
/** Its cards, first card first: the buried nine, the Ace face-up below it. */
const COLUMN_CARDS = [...faceDown("9C"), card("AS")];
/** Where the Ace sits in that column, counted from the bottom. */
const ACE_ROW = COLUMN_CARDS.length - 1;
/** The faces the column is drawn with, which is what decides the fan's offsets. */
const COLUMN_FACES = COLUMN_CARDS.map((spec) => spec.faceUp ?? true);

/**
 * Where the run's leading card is carried to: the middle of the 22-unit gap
 * between columns 0 and 1, well below the top row.
 *
 * `specs/table.md` gives the gaps between the columns to no pile, and column 0
 * holds only a face-down card while the run is in hand, so its drop rectangle
 * reaches no further right than `COLUMN_X[0] + CARD_W`. A center here lies in
 * none of the thirteen rectangles, so `specs/controls.md` returns the run.
 */
const NOWHERE = { x: (COLUMN_X[0] + CARD_W + COLUMN_X[1]) / 2, y: 420 };

/**
 * Frames each stage of the gesture is held for.
 *
 * Nothing is measured from them: every reading is a face, which no amount of
 * time changes under the rule. They are here so a build that turns the card on a
 * per-frame check has frames to do it in, and so the recording shows a player
 * the lift rather than a flicker. At the harness's 240 Hz step this is an eighth
 * of a second apiece.
 */
const HOLD_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the card beneath a lifted card face-down for the whole gesture", async () => {
  await openTable(h);
  const [buriedId] = await poseColumn(h, COLUMN, COLUMN_CARDS);

  const aceTopLeft = columnCardTopLeft(COLUMN, ACE_ROW, COLUMN_FACES);
  const press = cardCenter(aceTopLeft.x, aceTopLeft.y);

  const drive = await captureReplay(h, "lift", async () => {
    await h.debug.pointerDown(press.x, press.y);
    await h.advance(HOLD_FRAMES);
    const pressed = await h.snapshot();

    // Carry the run so its LEADING CARD'S CENTER reaches the gap, measured from
    // the offset the build itself reports, as `dragRunTo` does. A build that
    // holds the run at some other offset is still carried where the check meant.
    const held = pressed.drag;
    const centre =
      held === null ? { x: press.x, y: press.y } : cardCenter(held.x, held.y);
    const release = {
      x: press.x + (NOWHERE.x - centre.x),
      y: press.y + (NOWHERE.y - centre.y),
    };
    const midway = {
      x: (press.x + release.x) / 2,
      y: (press.y + release.y) / 2,
    };

    await h.debug.pointerMove(midway.x, midway.y);
    await h.advance(HOLD_FRAMES);
    const carried = await h.snapshot();

    await h.debug.pointerMove(release.x, release.y);
    await h.advance(HOLD_FRAMES);
    const arrived = await h.snapshot();

    await h.debug.pointerUp(release.x, release.y);
    await h.advance(HOLD_FRAMES);
    const released = await h.snapshot();

    return { pressed, carried, arrived, released, release };
  });

  assertNotNull(
    drive.pressed.drag,
    `the run in hand after a press at (${press.x}, ${press.y}), the center of ` +
      "the column's face-up Ace — specs/controls.md: the run enters the hand " +
      "on the press itself. Nothing in hand means the gesture this point is " +
      "about never happened",
  );
  assertEqual(
    Math.hypot(drive.release.x - press.x, drive.release.y - press.y) >
      DRAG_THRESHOLD,
    true,
    `whether the release lay farther than DRAG_THRESHOLD (${DRAG_THRESHOLD}) ` +
      "from the press, which is what makes this gesture a drop rather than a " +
      "click (specs/controls.md)",
  );

  const stages = [
    ["on the press", drive.pressed],
    ["with the run carried halfway", drive.carried],
    ["with the run over no pile", drive.arrived],
    ["after the release", drive.released],
  ] as const;
  for (const [when, snapshot] of stages) {
    assertEqual(
      requireCard(snapshot, buriedId, `the covered card ${when}`).faceUp,
      false,
      `the face of the ${COLUMN_CARDS[0].suit} 9 (id ${buriedId}) ${when} — ` +
        "specs/tableau.md: lifting cards off a column turns nothing while they " +
        "are in hand, and no move here was accepted",
    );
  }
});
