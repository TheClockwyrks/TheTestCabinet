// automove/face-down-does-nothing — a column whose lowest card is face-down
// sends nothing.
//
// `specs/instrumentation.md`: "The playable card is the waste's top card, or a
// column's lowest FACE-UP card. A pile that holds no playable card sends
// nothing, which covers ... a column whose lowest card is face-down."
// `specs/tableau.md` says why: "A face-down card is never moved and is never
// read. It becomes playable only once it has been turned."
//
// THE POSE IS THE ACE OF SPADES, FACE-DOWN, WITH FOUR EMPTY FOUNDATIONS. Turned
// up, that card is the single most sendable card in the game — every empty
// foundation accepts an Ace (`specs/foundations.md`). So the only thing standing
// between it and a foundation is its face, and a build that reads a face-down
// card sends it and reads as a different board. The card must also still be
// face-down afterwards: nothing was accepted, so `specs/tableau.md`'s turning
// rule, which belongs to an accepted move, has nothing to turn.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  faceDown,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  whereIs,
  type Harness,
} from "../harness";
import { FOUNDATION_COUNT } from "../constants";

/** The column, holding one face-down card and nothing else. */
const COLUMN = 0;
const BURIED = "AS";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sends nothing from a column whose lowest card is face-down", async () => {
  await openTable(h);
  const [buriedId] = await poseColumn(h, COLUMN, faceDown(BURIED));

  const posed = await h.snapshot();
  assertEqual(
    posed.autoFlip,
    true,
    "the automatic-flip gate this check leaves on",
  );
  assertEqual(
    topOf(pileOf(posed, "tableau", COLUMN))?.faceUp,
    false,
    "the face of the column's lowest card before the call",
  );

  const went = await h.debug.autoMove("tableau", COLUMN);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  assertEqual(went, false, "the verdict autoMove returned");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, buriedId),
    { pile: "tableau", index: COLUMN, row: 0 },
    "where the face-down card still lies",
  );
  assertEqual(
    topOf(pileOf(after, "tableau", COLUMN))?.faceUp,
    false,
    "the face of the column's lowest card after the call",
  );
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    assertLength(
      pileOf(after, "foundation", i),
      0,
      `the cards on foundation ${i} after the call`,
    );
  }
});
