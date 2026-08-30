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
// `simTime` IS THE ONE FIELD EXCLUDED FROM THE COMPARISON, and it has to be: it
// "accumulates every update's delta, whatever the screen"
// (specs/instrumentation.md), and raising the panel takes a frame, so a build
// whose sources are perfectly pure still reports a larger `simTime` afterwards.
// Excluding it outright would leave a hole, so it is asserted separately and
// exactly: after each toggle `simTime` has advanced by the frames the toggle
// drove and by nothing else. Every other field is compared as it stands,
// including the four gates, the thirteen piles, the waste's set memory and both
// counted fields.
//
// THE PANEL IS READ BEFORE THE STATE IS COMPARED. A board equal to itself proves
// the panel pure only if the panel went up at all: a build that registered no
// source, or whose toggle key is dead, leaves the game untouched for the most
// uninteresting of reasons. So the lines the toggled frame drew and the steady
// frame did not are counted first, and the comparison that follows is of a board
// a drawn panel was watching.
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
import { assertCloseTo, assertDeepEqual, assertGreaterThan } from "../assert";
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
  secondsFor,
  toggleOverlay,
  type CascadeSnapshot,
  type Harness,
} from "../harness";
import { overlayLines } from "./overlay";

/** The board posed: a column, a part-built foundation, and a waste with sets. */
const COLUMN = 0;
const COLUMN_CARDS = alternatingRun(KING, 5);
const FOUNDATION = 1;
const FOUNDATION_SUIT = "hearts";
const FOUNDATION_UP_TO = 3;
const WASTE_CARDS = fullDeck().slice(0, 4);
const WASTE_SETS: readonly number[] = [1, 3];

/** Frames a toggle drives: `toggleOverlay` draws exactly one. */
const TOGGLE_FRAMES = 1;

/**
 * How exactly `simTime` must match the game time the toggles drove, as decimal
 * places.
 *
 * The clock is exact — every frame adds the same `1 / TICK_HZ` — so the only
 * slack the reading needs is the rounding of a sum of doubles.
 */
const SIM_TIME_DIGITS = 6;

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
  // that has already been drawn once, and so the text a steady frame draws is
  // known before the panel adds its own.
  const steady = await h.drawFrame();

  /** The snapshot less `simTime`, which every frame moves whatever is drawn. */
  const settled = (
    snapshot: CascadeSnapshot,
  ): Omit<CascadeSnapshot, "simTime"> => {
    const { simTime: _simTime, ...rest } = snapshot;
    return rest;
  };

  const opened = h.snapshot();
  const before = settled(opened);

  const shown = await toggleOverlay(h);
  captureStill(h, "toggled");
  const upSnapshot = h.snapshot();
  const raised = settled(upSnapshot);

  assertGreaterThan(
    overlayLines(steady, shown).length,
    0,
    "lines the panel drew that the steady frame before it did not: the toggle " +
      "raises the overlay and the build registers sources onto it " +
      "(specs/instrumentation.md, Diagnostics), and a panel that drew nothing " +
      "would leave the board equal to itself for no reason worth reading",
  );

  assertDeepEqual(
    raised,
    before,
    "the state to stand exactly as it did before the overlay was raised " +
      "(specs/instrumentation.md: the debug overlay is read-only, and every " +
      "source is a pure read)",
  );
  assertCloseTo(
    upSnapshot.simTime - opened.simTime,
    secondsFor(TOGGLE_FRAMES),
    SIM_TIME_DIGITS,
    "the game time simTime gained while the overlay was raised, which is the " +
      "one frame the toggle drove and nothing more (specs/instrumentation.md)",
  );

  await toggleOverlay(h);
  const downSnapshot = h.snapshot();
  assertDeepEqual(
    settled(downSnapshot),
    raised,
    "the state to stand exactly as it did with the overlay up once it has " +
      "been lowered again (specs/instrumentation.md: the debug overlay is " +
      "read-only)",
  );
  assertCloseTo(
    downSnapshot.simTime - opened.simTime,
    secondsFor(TOGGLE_FRAMES * 2),
    SIM_TIME_DIGITS,
    "the game time simTime gained across both toggles, which is the two " +
      "frames they drove and nothing more (specs/instrumentation.md)",
  );
});
