// handling/release-on-legal-completes — a release over a pile that accepts the
// held run applies the move: the run is on the target and off its source.
//
// `specs/controls.md` fixes it: a release "Farther than `DRAG_THRESHOLD` from the
// press point" is a drop, and where the leading card's centre lies "In the
// rectangle of a pile that accepts the run" the result is "The move is applied:
// the run leaves its source and lands on that pile". `specs/tableau.md` fixes the
// acceptance: a column whose lowest card is rank `r` and colour `c` accepts a run
// led by rank `r - 1` of the other colour.
//
// WHAT THIS DECIDES, AND WHAT DECIDES IT ELSEWHERE. The gesture is the subject:
// a build whose `move()` works but whose released drop never lands the run fails
// here and nowhere else. Whether the rules accept the right cards is
// `tableau/build-down-alternating`; whether a run keeps its order is
// `runs/keeps-order`; where a release resolves TO is
// `handling/drop-target-by-position`.
//
// The release is carried far past `DRAG_THRESHOLD` (`5`), so it is a drop rather
// than a click without this check having to sit near that boundary;
// `handling/short-gesture-is-a-click` and `handling/long-gesture-is-a-drop` grade
// the boundary itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  card,
  cardCenter,
  captureStill,
  createHarness,
  dragRunTo,
  dropRect,
  openTable,
  pileOf,
  pileTopLeft,
  poseColumn,
  rectCenter,
  whereIs,
  type Harness,
} from "../harness";

/** Where the run is lifted from, and the card it is: a red seven, alone. */
const SOURCE = 0;
const HELD = "7H";

/** The column it is dropped on: a black eight, which accepts a red seven. */
const TARGET = 4;
const TARGET_CARD = "8S";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the run on the column the release resolved to", async () => {
  await openTable(h);
  const [heldId] = await poseColumn(h, SOURCE, [card(HELD)]);
  const [targetId] = await poseColumn(h, TARGET, [card(TARGET_CARD)]);

  // The target column holds one face-up card at the moment of the release, so
  // this is the rectangle `specs/table.md` fixes for a column holding cards.
  const landing = rectCenter(dropRect("tableau", TARGET, [true]));
  const from = pileTopLeft("tableau", SOURCE);
  const press = cardCenter(from.x, from.y);

  await dragRunTo(h, press.x, press.y, landing.x, landing.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "dropped");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, heldId),
    { pile: "tableau", index: TARGET, row: 1 },
    "where the released run ended up",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId, heldId],
    "the target column after the drop",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    "the cards the source column is left holding",
  );
});
