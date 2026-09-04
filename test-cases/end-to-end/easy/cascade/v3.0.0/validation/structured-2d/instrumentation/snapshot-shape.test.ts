// instrumentation/snapshot-shape — the snapshot reports every field the
// documented shape lists, with its documented type.
//
// THE RULE. specs/instrumentation.md fixes the object `snapshot()` returns
// field by field, and states why: "Every field an operation can set is present,
// so every operation is verifiable by setting a value and reading it back." A
// field that is missing, or that is reported as the wrong kind of value, breaks
// every check that reads it, so this point reads the whole shape at once.
//
// THE BOARD IS BUILT SO NO BRANCH OF THE SHAPE IS LEFT AT ITS EMPTY DEFAULT.
// Cards stand in all four pile kinds, so `stock`, `waste`, `foundations` and
// `tableau` each report a real card rather than an empty array; the waste
// carries two sets, so `wasteSets` and `wasteVisibleCount` report the memory
// rather than nothing; a run is held over a legal target, so `drag` and
// `dropTarget` report their NON-null shapes and `pointer`/`lastPress` report a
// real gesture; and two cards are in flight, so `flyers` reports its entries. A
// snapshot read on a bare title screen would report `null` for four fields and
// decide nothing about them.
//
// TYPES, NOT VALUES. What each field HOLDS is decided by the point whose
// requirement it is — `draw-one/deal-mode-reported` for the deal mode,
// `instrumentation/screen-reads-back` for each posed value,
// `instrumentation/waste-set-appends` for the set memory. This point asserts the
// shape: the field is present, and it is a number where a number is documented,
// a boolean where a boolean is, an array of cards where a pile is. The two
// exceptions are `version`, which the specification fixes outright, and the
// screen, whose documented type IS the list of four names.
//
// NO FRAME IS ADVANCED BETWEEN THE POSES AND THE READING, so the held run is
// still in hand when the snapshot is taken: under this engine a pose acts on
// the live game at the call and the pointer operations resolve before they
// return (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  ACE,
  ALL_SUITS,
  captureStill,
  card,
  colorOf,
  COLUMNS,
  createHarness,
  dropRectIn,
  EIGHT,
  FIVE,
  FOUNDATIONS,
  FOUR,
  grabPoint,
  KING,
  movePointerTo,
  NINE,
  openTable,
  poseCard,
  poseColumn,
  poseFlyer,
  poseStock,
  poseWaste,
  pressAt,
  QUEEN,
  rectCenter,
  SIX,
  THREE,
  TWO,
  type Harness,
  type SnapshotCard,
} from "../harness";
import { CASCADE_DEBUG_VERSION } from "../constants";
import { SNAPSHOT_FIELDS } from "../surface";

/** The four screen names the documented type of `screen` is (specs/screens.md). */
const SCREENS: readonly string[] = ["title", "howto", "playing", "won"];

/** The two colours a card's `color` is built from its suit as. */
const COLORS: readonly string[] = ["red", "black"];

/** The column the held run is lifted from, and the one it is held over. */
const SOURCE_COLUMN = 1;
const TARGET_COLUMN = 0;

/** The two cards the two columns carry: a black eight lifted over a red nine. */
const TARGET_CARD = card("hearts", NINE);
const LIFTED_CARD = card("spades", EIGHT);

/** The two cards on the stock, and the three on the waste under two sets. */
const STOCK_CARDS = [card("clubs", TWO), card("diamonds", THREE)];
const WASTE_CARDS = [
  card("hearts", FOUR),
  card("clubs", FIVE),
  card("spades", SIX),
];
const WASTE_SETS = [1, 2];

/** The foundation the Ace stands on. Any suit may start any slot. */
const FOUNDATION = 0;

/** The two cards in flight, posed clear of every pile so the still reads. */
const FLYERS = [
  { spec: card("diamonds", KING), x: 300, y: 400, vx: 140, vy: -80 },
  { spec: card("clubs", QUEEN), x: 700, y: 460, vx: -110, vy: 60 },
];

/** Every field one card reports, with the type the shape documents for it. */
function assertCardShape(
  subject: SnapshotCard | undefined,
  where: string,
): void {
  assertNotNull(subject ?? null, `a card reported for ${where}`);
  if (subject === undefined) return;
  assertEqual(typeof subject.id, "number", `${where}: the type of id`);
  assertContains(ALL_SUITS, subject.suit, `${where}: suit`);
  assertEqual(typeof subject.rank, "number", `${where}: the type of rank`);
  assertContains(COLORS, subject.color, `${where}: color`);
  assertEqual(typeof subject.faceUp, "boolean", `${where}: the type of faceUp`);
}

/** Every entry of a reported pile carries the documented card shape. */
function assertPileShape(pile: readonly SnapshotCard[], where: string): void {
  assertTrue(Array.isArray(pile), `${where} is reported as an array`);
  pile.forEach((subject, row) => {
    assertCardShape(subject, `${where} row ${row}`);
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every documented field with its documented type, on a board that fills every branch", async () => {
  openTable(h);

  // Cards in all four pile kinds.
  poseStock(h, STOCK_CARDS);
  poseWaste(h, WASTE_CARDS, WASTE_SETS);
  poseCard(h, "foundation", FOUNDATION, card("spades", ACE));
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  poseColumn(h, SOURCE_COLUMN, [LIFTED_CARD]);

  // Two cards in flight.
  for (const flyer of FLYERS) {
    poseFlyer(h, flyer.spec, flyer.x, flyer.y, flyer.vx, flyer.vy);
  }

  // A run in hand over a legal target: pressed on the source column's only
  // card, then swept until its centre lies inside the target column's drop
  // rectangle (specs/table.md), and NOT released.
  const grab = grabPoint(h.snapshot(), SOURCE_COLUMN, 0);
  pressAt(h, grab.x, grab.y);
  const over = rectCenter(dropRectIn(h.snapshot(), "tableau", TARGET_COLUMN));
  movePointerTo(h, over.x, over.y);

  const snap = h.snapshot();

  await h.advance(1);
  captureStill(h, "posed");

  // Nothing the documented shape lists is missing.
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(snap, field, "a documented snapshot field");
  }

  // The scalars, each with its documented type; `version` is the one whose
  // value the specification fixes outright.
  assertEqual(snap.version, CASCADE_DEBUG_VERSION, "version");
  assertContains(SCREENS, snap.screen, "screen is one of the four documented");
  assertEqual(typeof snap.dealMode, "string", "the type of dealMode");
  assertEqual(typeof snap.turnCount, "number", "the type of turnCount");
  assertEqual(typeof snap.dealModeLabel, "string", "the type of dealModeLabel");
  assertEqual(typeof snap.muted, "boolean", "the type of muted");
  for (const gate of [
    "autoFlip",
    "winDetect",
    "launching",
    "trailPainting",
  ] as const) {
    assertEqual(typeof snap[gate], "boolean", `the type of ${gate}`);
  }
  assertEqual(
    typeof snap.wasteVisibleCount,
    "number",
    "the type of wasteVisibleCount",
  );
  assertEqual(typeof snap.launchClock, "number", "the type of launchClock");
  assertEqual(typeof snap.launched, "number", "the type of launched");
  assertEqual(typeof snap.cascadeDone, "boolean", "the type of cascadeDone");
  assertEqual(typeof snap.trailStamps, "number", "the type of trailStamps");
  assertEqual(typeof snap.simTime, "number", "the type of simTime");

  // The thirteen piles, each an array of cards, and the two the shape fixes the
  // length of.
  assertPileShape(snap.stock, "stock");
  assertPileShape(snap.waste, "waste");
  assertLength(snap.foundations, FOUNDATIONS.length, "reported foundations");
  assertLength(snap.tableau, COLUMNS.length, "reported tableau columns");
  for (const index of FOUNDATIONS) {
    assertPileShape(snap.foundations[index], `foundation ${index}`);
  }
  for (const index of COLUMNS) {
    assertPileShape(snap.tableau[index], `column ${index}`);
  }

  // The posed board really filled every pile kind, so none of the readings
  // above was taken over an empty array.
  assertLength(snap.stock, STOCK_CARDS.length, "cards on the posed stock");
  assertLength(snap.waste, WASTE_CARDS.length, "cards on the posed waste");
  assertLength(
    snap.foundations[FOUNDATION],
    1,
    "cards on the posed foundation",
  );
  assertLength(
    snap.tableau[TARGET_COLUMN],
    1,
    "cards on the posed target column",
  );

  // A card's `color` is built from its suit (specs/deal.md), so the reading is
  // held to the suit it was reported beside rather than to a fixed value.
  const ace = snap.foundations[FOUNDATION][0];
  assertCardShape(ace, "the posed foundation's card");
  assertEqual(
    ace?.color,
    colorOf(ace?.suit ?? "spades"),
    "the colour reported for the foundation's card, built from its suit",
  );

  // The set memory.
  assertTrue(
    Array.isArray(snap.wasteSets),
    "wasteSets is reported as an array",
  );
  for (const count of snap.wasteSets) {
    assertEqual(typeof count, "number", "a wasteSets entry");
  }

  // The run in hand, and the pile a release would land it on.
  assertNotNull(snap.drag, "drag, with a run held over a legal target");
  assertTrue(Array.isArray(snap.drag?.cards), "drag.cards is an array");
  for (const held of snap.drag?.cards ?? []) {
    assertCardShape(held, "a card of the held run");
  }
  assertContains(
    ["waste", "foundation", "tableau"],
    snap.drag?.fromPile,
    "drag.fromPile",
  );
  assertEqual(
    typeof snap.drag?.fromIndex,
    "number",
    "the type of drag.fromIndex",
  );
  assertEqual(typeof snap.drag?.x, "number", "the type of drag.x");
  assertEqual(typeof snap.drag?.y, "number", "the type of drag.y");

  assertNotNull(
    snap.dropTarget,
    "dropTarget, with the run over a legal target",
  );
  assertContains(
    ["foundation", "tableau"],
    snap.dropTarget?.pile,
    "dropTarget.pile",
  );
  assertEqual(
    typeof snap.dropTarget?.index,
    "number",
    "the type of dropTarget.index",
  );

  // The pointer, and the press the double-click rule is measured against.
  assertEqual(typeof snap.pointer.x, "number", "the type of pointer.x");
  assertEqual(typeof snap.pointer.y, "number", "the type of pointer.y");
  assertEqual(typeof snap.pointer.down, "boolean", "the type of pointer.down");
  assertNotNull(snap.lastPress, "lastPress, after a press was driven");
  assertEqual(typeof snap.lastPress?.x, "number", "the type of lastPress.x");
  assertEqual(typeof snap.lastPress?.y, "number", "the type of lastPress.y");
  assertEqual(typeof snap.lastPress?.at, "number", "the type of lastPress.at");

  // The cards in flight.
  assertLength(snap.flyers, FLYERS.length, "cards reported in flight");
  snap.flyers.forEach((flyer, index) => {
    const where = `flyer ${index}`;
    assertEqual(typeof flyer.id, "number", `${where}: the type of id`);
    assertContains(ALL_SUITS, flyer.suit, `${where}: suit`);
    assertEqual(typeof flyer.rank, "number", `${where}: the type of rank`);
    for (const axis of ["x", "y", "vx", "vy"] as const) {
      assertEqual(
        typeof flyer[axis],
        "number",
        `${where}: the type of ${axis}`,
      );
    }
  });
});
