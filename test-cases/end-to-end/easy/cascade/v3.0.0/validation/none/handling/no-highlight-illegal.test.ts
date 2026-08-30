// handling/no-highlight-illegal — a pile that would refuse the held run is not
// reported as the drop target, even while the run is squarely over it.
//
// `specs/controls.md` fixes it: "A pile is the drop target only while the release
// rule below would resolve the run to it AND that pile accepts the run."
// `specs/tableau.md` fixes the refusal: a column whose lowest card is rank `r`
// and colour `c` accepts only a run led by rank `r - 1` of the other colour, and
// "refuses every other run offered to it".
//
// THE HALF OF THE RULE THIS DECIDES. Both halves have to hold for a pile to be
// reported, so the scenario satisfies the first and breaks the second: the
// leading card's centre is carried INSIDE the target column's drop rectangle, as
// `specs/table.md` fixes it, and the column refuses the run all the same. A build
// that reports whatever pile the run is over, without asking whether it would be
// accepted, names the column here and fails; a build that applies both halves
// reports nothing.
//
// WHAT THE POSE DISTINGUISHES. The target's lowest card is the same RANK as the
// run's leading card and the opposite colour, so a build that checks only the
// colour reports the column, and a build that checks only that the ranks differ
// by anything reports it too. The source column, emptied by the lift, accepts
// only a King-led run, so it is not reported either.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull, assertTrue } from "../assert";
import {
  card,
  cardCenter,
  captureStill,
  createHarness,
  dropRect,
  openTable,
  pileTopLeft,
  pointInRect,
  poseColumn,
  rectCenter,
  type Harness,
} from "../harness";

/** Where the run is lifted from, and the card it is: a red seven, alone. */
const SOURCE = 0;
const HELD = "7H";

/** The column it is carried over: a black seven, which refuses a red seven. */
const TARGET = 4;
const TARGET_CARD = "7S";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no target while the run is over a column that refuses it", async () => {
  await openTable(h);
  await poseColumn(h, SOURCE, [card(HELD)]);
  await poseColumn(h, TARGET, [card(TARGET_CARD)]);

  // The target column holds one face-up card while the run is carried over it,
  // so this is the rectangle `specs/table.md` fixes for a column holding cards.
  const rect = dropRect("tableau", TARGET, [true]);
  const landing = rectCenter(rect);

  const from = pileTopLeft("tableau", SOURCE);
  const press = cardCenter(from.x, from.y);
  await h.debug.pointerDown(press.x, press.y);
  const lifted = (await h.snapshot()).drag;
  assertNotNull(lifted, "the run in hand on the press");
  if (lifted === null) return;

  // Carry the run so the LEADING CARD'S CENTRE sits inside that rectangle,
  // whatever offset the build took on the press.
  const centre = cardCenter(lifted.x, lifted.y);
  await h.debug.pointerMove(
    press.x + (landing.x - centre.x),
    press.y + (landing.y - centre.y),
  );
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unhighlighted");

  const over = (await h.snapshot()).drag;
  assertNotNull(over, "the run still in hand over the target");
  if (over === null) return;
  const carried = cardCenter(over.x, over.y);
  // The first half of the rule really is satisfied, so the refusal is what the
  // reading below is deciding.
  assertTrue(
    pointInRect(carried.x, carried.y, rect),
    "the leading card's centre inside the target column's drop rectangle",
  );
  assertNull(
    (await h.snapshot()).dropTarget,
    "the target reported while the run is over a column that refuses it",
  );
});
