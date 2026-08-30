// instrumentation/set-card-face — one card's face is set, both ways, and no
// other card's face moves with it.
//
// THE RULE. specs/instrumentation.md, under The cards: "`setCardFaceUp(id,
// faceUp)` — Sets one card's face." One card, named by its id, and the value
// the caller gave — not a toggle, not a pile, and not the table.
//
// THE BOARD IS BUILT SO EVERY WRONG MODEL READS DIFFERENTLY. Three cards are
// posed: the SUBJECT face-up on one column, and on another a BYSTANDER face-down
// beside a second bystander face-up. Then the subject is set face-down and set
// face-up again. A build that sets every card to the value it was given turns
// the face-up bystander down on the first call and the face-down one up on the
// second; a build that sets only the pile it was pointed at leaves both
// bystanders alone but is not distinguished here — which is why the subject and
// the bystanders are on different columns, so a build that swept the subject's
// pile is caught by the whole-board reading. A build that toggles rather than
// setting reads the same result on the first call and the wrong one on the
// second, since it is asked for `true` on a card that is already down.
//
// BOTH DIRECTIONS ARE READ, in the order the rule states them, and both are
// read against the same two bystanders, so a build with a working "turn down"
// and a broken "turn up" grades differently from one with both broken.
//
// WHAT IT DOES NOT DECIDE. That the game turns a newly exposed card of its own
// accord is `tableau.flip-exposed`, and gating that turning is
// `instrumentation/auto-flip-gate`. This point is the pose alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  FOUR,
  NINE,
  SEVEN,
  captureStill,
  card,
  cardById,
  createHarness,
  down,
  openTable,
  poseCard,
  poseColumn,
  up,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The column the subject stands on, and the one the two bystanders share. */
const SUBJECT_COLUMN = 0;
const BYSTANDER_COLUMN = 1;

/** The card whose face is set, posed face-up. */
const SUBJECT = up(card("spades", NINE));

/** The two cards that must not move: one face-down, one face-up. */
const BYSTANDER_DOWN = down(card("hearts", FOUR));
const BYSTANDER_UP = up(card("clubs", SEVEN));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the named card's face both ways and leaves every other face where it was", async () => {
  openTable(h);
  const subject = poseCard(h, "tableau", SUBJECT_COLUMN, SUBJECT);
  const [bystanderDown, bystanderUp] = poseColumn(h, BYSTANDER_COLUMN, [
    BYSTANDER_DOWN,
    BYSTANDER_UP,
  ]);

  const faces = (snapshot: CascadeSnapshot): unknown => ({
    subject: cardById(snapshot, subject)?.faceUp,
    bystanderDown: cardById(snapshot, bystanderDown)?.faceUp,
    bystanderUp: cardById(snapshot, bystanderUp)?.faceUp,
  });

  h.debug.setCardFaceUp(subject, false);
  const turnedDown = faces(h.snapshot());

  h.debug.setCardFaceUp(subject, true);
  const turnedUp = faces(h.snapshot());

  await h.advance(1);
  captureStill(h, "faces");

  assertDeepEqual(
    turnedDown,
    { subject: false, bystanderDown: false, bystanderUp: true },
    "the three faces after setCardFaceUp turned the subject DOWN: it sets " +
      "one card's face (specs/instrumentation.md)",
  );
  assertDeepEqual(
    turnedUp,
    { subject: true, bystanderDown: false, bystanderUp: true },
    "the three faces after setCardFaceUp turned the same card UP again: it " +
      "sets the value it was given rather than toggling, and it sets one " +
      "card (specs/instrumentation.md)",
  );
});
