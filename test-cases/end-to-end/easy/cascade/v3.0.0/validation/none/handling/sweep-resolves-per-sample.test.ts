// handling/sweep-resolves-per-sample — a press, a move and a release delivered
// to the real pointer before a single frame's update are all answered, so the
// gesture lifts the run and completes the drop.
//
// `specs/controls.md` fixes it: "Every sample a frame delivers is answered on its
// own, in the order it arrived, so a press and the release that followed it
// inside one frame both take effect and a gesture is never reduced to the last
// position of the frame that carried it."
//
// WHY THIS USES THE REAL MOUSE. The subject is what a FRAME did with a player's
// input, so the three events are delivered to the page itself, with no frame run
// between them, and then exactly one frame is run. A build that keeps only each
// frame's last sample sees the release alone, has nothing in hand, and leaves the
// card where it lay; a build that folds the samples into a single position
// somewhere along the path sees a press and a release at the same point and reads
// the gesture as a click, which also leaves the card where it lay. Only a build
// that answers all three in order lands the card on the target.
//
// WHERE THE RELEASE IS AIMED. At the centre of the target column's drop rectangle
// (`specs/table.md`). The press is at the centre of the card's own footprint, and
// `specs/controls.md` has the run keep the offset between the press point and the
// leading card's top-left, so the leading card's centre sits exactly under the
// pointer for the whole gesture and the release resolves where the pointer is.
// The distance is far past `DRAG_THRESHOLD` (`5`), so the gesture is a drop.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  card,
  cardCenter,
  captureStill,
  createHarness,
  dropRect,
  mouseSweepInOneFrame,
  openTable,
  pileOf,
  pileTopLeft,
  poseColumn,
  rectCenter,
  whereIs,
  type Harness,
} from "../harness";
import { STAGE_H } from "../constants";

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

it("answers the press, the move and the release a single frame delivered", async () => {
  await openTable(h);
  const [heldId] = await poseColumn(h, SOURCE, [card(HELD)]);
  const [targetId] = await poseColumn(h, TARGET, [card(TARGET_CARD)]);

  const from = pileTopLeft("tableau", SOURCE);
  const press = cardCenter(from.x, from.y);
  const landing = rectCenter(dropRect("tableau", TARGET, [true]));
  // One waypoint well away from both ends, so a build that keeps a middle sample
  // rather than all of them is caught too. It stays on the stage and clear of the
  // HUD strip, which `specs/table.md` puts at the bottom of the table.
  const waypoint = { x: (press.x + landing.x) / 2, y: STAGE_H / 2 };

  await mouseSweepInOneFrame(h, [press, waypoint, landing]);

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "dropped");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, heldId),
    { pile: "tableau", index: TARGET, row: 1 },
    "where the one frame's gesture put the card",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId, heldId],
    "the target column after the one frame's drop",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    "the cards the source column is left holding",
  );
});
