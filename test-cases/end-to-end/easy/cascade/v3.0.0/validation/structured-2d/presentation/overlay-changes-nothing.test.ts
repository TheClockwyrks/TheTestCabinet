// presentation/overlay-changes-nothing — raising the overlay changes nothing.
//
// THE RULE. specs/instrumentation.md, "Diagnostics": "The debug overlay is
// read-only", and of the sources a build registers, "keep every source a pure
// read, so watching the overlay leaves the game exactly as it is." A diagnostic
// that moves the game it is reporting on is a diagnostic that lies about it, and
// every other point in this suite that reads the panel would be reading a board
// the panel had changed.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the state is untouched by the
// panel going up and by its coming down again. WHICH sources are registered is
// the other four overlay points'.
//
// HOW IT IS READ. The whole snapshot, compared field for field, before the
// toggle, after it, and after the toggle back. The snapshot reports every field
// an operation can set (specs/instrumentation.md), so a source that wrote to the
// state — turning a card, moving a card home, clearing a set, counting itself
// into `trailStamps` — shows up here whatever it wrote to.
//
// `simTime` IS THE ONE FIELD EXCLUDED, and it has to be: it "accumulates every
// update's delta, whatever the screen" (specs/instrumentation.md), and raising
// the panel takes a frame, so a build whose sources are perfectly pure still
// reports a larger `simTime` afterwards. Every other field is compared as it
// stands, including the four gates, the thirteen piles, the waste's set memory
// and both counted fields.
//
// A FRAME IS RUN BEFORE THE FIRST READING, so what is compared is three
// snapshots each taken just after a frame, and a build that changes something on
// its FIRST frame is not read as the panel having changed it.
//
// THE BOARD IS POSED RATHER THAN EMPTY, so the comparison has something to
// notice: a column with a run on it, a foundation part-built, and a waste
// holding cards across two remembered sets. An empty table would be equal to
// itself however carelessly a source were written.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, then three of them
// are posed. Nothing is in hand and no gate is touched.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  alternatingRun,
  captureStill,
  createHarness,
  fullDeck,
  KING,
  openTable,
  poseColumn,
  poseFoundation,
  poseWaste,
  toggleOverlay,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The board posed: a column, a part-built foundation, and a waste with sets. */
const COLUMN = 0;
const COLUMN_CARDS = alternatingRun(KING, 5);
const FOUNDATION = 1;
const FOUNDATION_SUIT = "hearts";
const FOUNDATION_UP_TO = 3;
const WASTE_CARDS = fullDeck().slice(0, 4);
const WASTE_SETS: readonly number[] = [1, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every field of the state as it was when the overlay is raised and lowered", async () => {
  openTable(h);
  poseColumn(h, COLUMN, COLUMN_CARDS);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_UP_TO);
  poseWaste(h, WASTE_CARDS, WASTE_SETS);
  // A frame with the panel down, so what follows is compared against a board
  // that has already been drawn once.
  await h.drawFrame();

  /** The snapshot less `simTime`, which every frame moves whatever is drawn. */
  const settled = (
    snapshot: CascadeSnapshot,
  ): Omit<CascadeSnapshot, "simTime"> => {
    const { simTime: _simTime, ...rest } = snapshot;
    return rest;
  };

  const before = settled(h.snapshot());

  await toggleOverlay(h);
  captureStill(h, "toggled");
  const raised = settled(h.snapshot());
  assertDeepEqual(
    raised,
    before,
    "the state to stand exactly as it did before the overlay was raised " +
      "(specs/instrumentation.md: the debug overlay is read-only, and every " +
      "source is a pure read)",
  );

  await toggleOverlay(h);
  assertDeepEqual(
    settled(h.snapshot()),
    raised,
    "the state to stand exactly as it did with the overlay up once it has " +
      "been lowered again (specs/instrumentation.md: the debug overlay is " +
      "read-only)",
  );
});
