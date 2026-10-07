// handling/sweep-resolves-per-sample — every pointer sample a frame delivers is
// answered, in the order it arrived.
//
// THE RULE. specs/controls.md: "Every sample a frame delivers is answered on its
// own, in the order it arrived, so a press and the release that followed it inside
// one frame both take effect and a gesture is never reduced to the last position
// of the frame that carried it."
//
// HOW IT IS DECIDED. Crossing several piles leaves no trace in Cascade — a build
// that answers every sample and one that keeps only each frame's last sample both
// end over the same pile — so the whole gesture is delivered inside ONE frame
// instead: a press on a column's card, eight moves carrying it across the table,
// and a release over a column that accepts it, all dispatched to the engine's own
// pointer before a single update runs. A build that answers every sample lifts the
// run on the press and completes the drop on the release; a build that folds the
// frame's samples into their last position sees the release alone, has nothing in
// hand, and leaves the card where it was.
//
// THE REAL POINTER, NOT THE DEBUG SURFACE. `dragThroughEvents` dispatches
// pointer-shaped events at the surface's own event target — the path the player's
// pointer takes, which the engine turns into the frame's ordered sample list. The
// debug surface's `pointerDown`/`pointerMove`/`pointerUp` take effect at the call
// (specs/instrumentation.md) and so could not put more than one sample inside one
// frame; every other point in this group drives those instead, and this one is the
// only point whose subject is the sample list itself.
//
// THE BOARD. A red five carried onto a black six, which specs/tableau.md has a
// column accept, with the leading card ending on the target column's anchor so its
// centre lies inside that column's drop rectangle (specs/table.md). The release
// lies `122` units from the press, far past `DRAG_THRESHOLD` (`5`), so the gesture
// is unambiguously a drop.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  card,
  cardTopLeft,
  createHarness,
  dragThroughEvents,
  FIVE,
  grabPoint,
  openTable,
  pileTopLeft,
  poseColumn,
  SIX,
  type Harness,
} from "../harness";
import { carryTo, pileText } from "./gestures";

/** The column the run is lifted from, and the column it is released over. */
const FROM_COLUMN = 0;
const TO_COLUMN = 1;
const FROM_ROW = 0;

/** A red five onto a black six, which specs/tableau.md has a column accept. */
const RUN = card("hearts", FIVE);
const TARGET = card("spades", SIX);

/** How many moves the gesture delivers between its press and its release. */
const STEPS = 8;

/** The two columns as they must read after the one frame that carried it. */
const LANDED = ["6S", "5H"];
const EMPTIED: string[] = [];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lifts the run and completes the drop from a whole gesture delivered inside one frame", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);

  const posed = h.snapshot();
  const press = grabPoint(posed, FROM_COLUMN, FROM_ROW);
  const lead = cardTopLeft(posed, "tableau", FROM_COLUMN, FROM_ROW);
  const release = carryTo(press, lead, pileTopLeft("tableau", TO_COLUMN));

  await dragThroughEvents(h, press, release, STEPS);

  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "dropped");

  assertDeepEqual(
    pileText(after.tableau[TO_COLUMN]),
    LANDED,
    `column ${String(TO_COLUMN)} after a press, ${String(STEPS)} moves and a ` +
      "release all delivered before one frame's update: every sample the frame " +
      "carried is answered on its own, in order (specs/controls.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[FROM_COLUMN]),
    EMPTIED,
    `column ${String(FROM_COLUMN)} after that frame: the press lifted the run ` +
      "and the release landed it (specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after that frame, which the release ended " +
      "(specs/controls.md)",
  );
});
