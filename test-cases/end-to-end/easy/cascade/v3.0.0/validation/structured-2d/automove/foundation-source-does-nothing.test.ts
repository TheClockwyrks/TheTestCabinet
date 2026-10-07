// automove/foundation-source-does-nothing — an auto-move from a foundation does
// nothing.
//
// specs/instrumentation.md: the playable card is the waste's top card or a column's
// lowest face-up card, and a pile that holds no playable card sends nothing, which
// covers a foundation. The call returns `false` when nothing moved. The card named
// is already home, so there is nowhere for an auto-move to send it.
//
// THE POSE MAKES THE WRONG ANSWER VISIBLE. The one foundation holds the Ace of
// spades and the other three are empty, and an empty foundation accepts an Ace
// (specs/foundations.md). So a build that treats a foundation as a source finds a
// foundation that would take the card and shuffles the Ace across to it; a build
// that reads the specification finds no playable card and leaves the four
// foundations as they are. The whole board is compared, so a shuffled Ace is caught
// wherever it landed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  captureStill,
  createHarness,
  openTable,
  poseFoundation,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The foundation the call names, holding one card. */
const FOUNDATION = 0;
/** The card on it. Every other foundation is empty, so every one would take it. */
const HOME_SUIT = "spades";
const HOME_UP_TO = ACE;
const HOME_CARD_TEXT = "AS";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends nothing from a foundation and leaves all four as they were", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, HOME_SUIT, HOME_UP_TO);
  const before = boardText(h.snapshot());

  const went = h.debug.autoMove("foundation", FOUNDATION);
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "unchanged");

  assertEqual(
    went,
    false,
    `autoMove("foundation", ${FOUNDATION}): a foundation holds no playable ` +
      "card, and the card named is already home (specs/instrumentation.md)",
  );
  assertDeepEqual(
    after,
    before,
    `the board after the call: ${HOME_CARD_TEXT} is still on foundation ` +
      `${FOUNDATION} (specs/instrumentation.md)`,
  );
});
