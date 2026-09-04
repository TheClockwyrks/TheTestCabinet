// instrumentation/snapshot-shape — `snapshot()` reports the whole object
// `specs/instrumentation.md` documents, with every field at its documented type,
// read off a board that is actually carrying one of everything.
//
// THE RULE. `specs/instrumentation.md` fixes the shape exactly under Snapshot
// shape — "`snapshot` returns exactly this object. Every field an operation can
// set is present, so every operation is verifiable by setting a value and reading
// it back" — and the rest of this suite reads its verdicts out of that object. A
// field that is absent, or that answers with something of the wrong kind, would
// otherwise cost the point that asks for it somewhere else, under a heading about
// a mechanic. This point names it here instead.
//
// THE BOARD IS POSED SO NO ENTRY IS EMPTY. An empty array satisfies "is an array"
// while saying nothing about the entries the specification describes, so the
// board carries cards in all four pile kinds, a waste of two sets, a run in hand
// held over a column that accepts it, and two cards in flight — and every
// per-entry field is read off a real entry.
//
// THE RUN IS HELD RATHER THAN POSED, because `drag`, `dropTarget`, `pointer` and
// `lastPress` have no pose of their own: `specs/controls.md` puts the run in the
// hand "on the press itself", so a press on the column's face-up card and one
// move that carries the card's centre into the neighbouring column's drop
// rectangle is the only way to read all four at once. The release is never made,
// so the run is still in hand at the reading.
//
// WHAT THIS DOES NOT DECIDE. Nothing about the VALUES beyond the three that make
// the reading non-vacuous — that a run really was lifted, that a target really
// was resolved, and that the posed rosters are the ones being reported. What each
// value MEANS is decided by the point that owns it: `handling/*` for the press
// and the target, `stock/*` for the sets, `cascade/*` for the flight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  CASCADE_DEBUG_VERSION,
  FOUNDATION_COUNT,
  TABLEAU_COLUMNS,
} from "../constants";
import {
  captureStill,
  card,
  cardCenter,
  cards,
  columnCardTopLeft,
  createHarness,
  dropRect,
  faceDown,
  openTable,
  poseColumn,
  poseFlyer,
  poseFoundation,
  poseStock,
  poseWaste,
  rectCenter,
  type CascadeSnapshot,
  type Harness,
  type Screen,
} from "../harness";

/** The four screens, as `specs/instrumentation.md` lists them. */
const SCREENS: readonly Screen[] = ["title", "howto", "playing", "won"];

/** The two colours a card is reported in (`specs/deal.md`). */
const COLORS = ["red", "black"] as const;

/** The stock and the waste, bottom card first, and the waste's two sets. */
const STOCK = ["2C", "3D"] as const;
const WASTE = ["4H", "5S", "6D", "7C", "8H"] as const;
const WASTE_SETS = [2, 3] as const;

/** The foundation that is filled, its suit, and how far up it is built. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades" as const;
const FOUNDATION_UP_TO = 3;

/**
 * The two columns the run is carried between.
 *
 * The source holds a face-down card under one face-up card, so the press lifts
 * exactly one card and leaves the column standing; the target's lowest card is
 * the red six, which `specs/tableau.md` has accept the black five.
 */
const FROM_COLUMN = 0;
const TO_COLUMN = 1;
const FROM_CARDS = [card("9C", false), card("5S")] as const;
const TO_CARDS = [card("6H")] as const;

/** The two cards put in flight, each with a velocity of its own. */
const FLYERS = [
  { x: 300, y: 220, vx: 140, vy: -60, suit: "hearts" as const, rank: 9 },
  { x: 700, y: 340, vx: -220, vy: 40, suit: "clubs" as const, rank: 4 },
];

/** A launch clock that is not the zero `reset` left, so the field is read at a value. */
const LAUNCH_CLOCK = 0.07;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every documented field, from a board carrying one of everything", async () => {
  await openTable(h);

  await poseStock(h, faceDown(...STOCK));
  await poseWaste(h, cards(...WASTE), [...WASTE_SETS]);
  await poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_UP_TO);
  await poseColumn(h, FROM_COLUMN, [...FROM_CARDS]);
  await poseColumn(h, TO_COLUMN, [...TO_CARDS]);
  for (const flyer of FLYERS) await poseFlyer(h, flyer);
  await h.debug.setLaunchClock(LAUNCH_CLOCK);

  // The press lifts the column's face-up card, which enters the hand on the
  // press itself (`specs/controls.md`), and one move carries that card's centre
  // into the neighbouring column's drop rectangle so a target is resolved.
  const grabbed = columnCardTopLeft(
    FROM_COLUMN,
    FROM_CARDS.length - 1,
    FROM_CARDS.map((c) => c.faceUp ?? true),
  );
  const press = cardCenter(grabbed.x, grabbed.y);
  await h.debug.pointerDown(press.x, press.y);
  const lifted = (await h.snapshot()).drag;
  assertEqual(
    lifted === null,
    false,
    `whether the press on column ${FROM_COLUMN}'s face-up card lifted ` +
      `nothing — a run enters the hand on the press itself ` +
      `(specs/controls.md), and this point cannot read a drag that was never ` +
      `made`,
  );
  const held = lifted ?? { x: press.x, y: press.y };
  const centre = cardCenter(held.x, held.y);
  const target = rectCenter(
    dropRect(
      "tableau",
      TO_COLUMN,
      TO_CARDS.map((c) => c.faceUp ?? true),
    ),
  );
  await h.debug.pointerMove(
    press.x + (target.x - centre.x),
    press.y + (target.y - centre.y),
  );

  await h.advance(1);
  // Before the assertions, so a missing field still leaves the picture of the
  // board every reported value was read from.
  await captureStill(h, "posed");

  const s: CascadeSnapshot = await h.snapshot();

  assertEqual(s.version, CASCADE_DEBUG_VERSION, "snapshot().version");
  assertEqual(
    SCREENS.includes(s.screen),
    true,
    `snapshot().screen, one of ${JSON.stringify(SCREENS)}`,
  );
  assertEqual(typeof s.dealMode, "string", "snapshot().dealMode");
  assertEqual(typeof s.turnCount, "number", "snapshot().turnCount");
  assertEqual(typeof s.dealModeLabel, "string", "snapshot().dealModeLabel");
  assertEqual(typeof s.muted, "boolean", "snapshot().muted");

  assertEqual(typeof s.autoFlip, "boolean", "snapshot().autoFlip");
  assertEqual(typeof s.winDetect, "boolean", "snapshot().winDetect");
  assertEqual(typeof s.launching, "boolean", "snapshot().launching");
  assertEqual(typeof s.trailPainting, "boolean", "snapshot().trailPainting");

  /** Every field of one reported card is of the type the specification gives it. */
  const assertCard = (entry: unknown, what: string): void => {
    const view = entry as Record<string, unknown>;
    assertEqual(typeof view.id, "number", `${what}.id`);
    assertEqual(typeof view.suit, "string", `${what}.suit`);
    assertEqual(typeof view.rank, "number", `${what}.rank`);
    assertEqual(
      COLORS.includes(view.color as (typeof COLORS)[number]),
      true,
      `${what}.color, one of ${JSON.stringify(COLORS)}`,
    );
    assertEqual(typeof view.faceUp, "boolean", `${what}.faceUp`);
  };

  assertLength(
    s.stock,
    STOCK.length,
    "the cards this scenario put on the stock",
  );
  for (const entry of s.stock) assertCard(entry, "snapshot().stock[]");

  assertLength(
    s.waste,
    WASTE.length,
    "the cards this scenario put on the waste",
  );
  for (const entry of s.waste) assertCard(entry, "snapshot().waste[]");

  assertLength(
    s.wasteSets,
    WASTE_SETS.length,
    "the sets this scenario posed onto the waste's memory",
  );
  for (const count of s.wasteSets) {
    assertEqual(typeof count, "number", "snapshot().wasteSets[]");
  }
  assertEqual(
    typeof s.wasteVisibleCount,
    "number",
    "snapshot().wasteVisibleCount",
  );

  assertLength(
    s.foundations,
    FOUNDATION_COUNT,
    "the foundations snapshot() reports",
  );
  assertGreaterThan(
    s.foundations[FOUNDATION].length,
    0,
    `the cards on foundation ${FOUNDATION}, which this scenario built up to ` +
      `rank ${FOUNDATION_UP_TO}`,
  );
  for (const pile of s.foundations) {
    for (const entry of pile) assertCard(entry, "snapshot().foundations[][]");
  }

  assertLength(s.tableau, TABLEAU_COLUMNS, "the columns snapshot() reports");
  assertGreaterThan(
    s.tableau[FROM_COLUMN].length,
    0,
    `the cards left in column ${FROM_COLUMN} with its face-up card in hand`,
  );
  for (const pile of s.tableau) {
    for (const entry of pile) assertCard(entry, "snapshot().tableau[][]");
  }

  assertEqual(
    s.drag === null,
    false,
    "snapshot().drag, with a run still in hand at the reading",
  );
  const drag = s.drag;
  if (drag !== null) {
    assertGreaterThan(
      drag.cards.length,
      0,
      "snapshot().drag.cards, of which cards[0] is the grabbed card",
    );
    for (const entry of drag.cards)
      assertCard(entry, "snapshot().drag.cards[]");
    assertEqual(typeof drag.fromPile, "string", "snapshot().drag.fromPile");
    assertEqual(typeof drag.fromIndex, "number", "snapshot().drag.fromIndex");
    assertEqual(typeof drag.x, "number", "snapshot().drag.x");
    assertEqual(typeof drag.y, "number", "snapshot().drag.y");
  }

  assertEqual(
    s.dropTarget === null,
    false,
    `snapshot().dropTarget, with the held card's centre inside column ` +
      `${TO_COLUMN}'s drop rectangle over a card that accepts it ` +
      `(specs/controls.md, specs/tableau.md)`,
  );
  const dropTarget = s.dropTarget;
  if (dropTarget !== null) {
    assertEqual(typeof dropTarget.pile, "string", "snapshot().dropTarget.pile");
    assertEqual(
      typeof dropTarget.index,
      "number",
      "snapshot().dropTarget.index",
    );
  }

  assertEqual(typeof s.pointer.x, "number", "snapshot().pointer.x");
  assertEqual(typeof s.pointer.y, "number", "snapshot().pointer.y");
  assertEqual(typeof s.pointer.down, "boolean", "snapshot().pointer.down");

  assertEqual(
    s.lastPress === null,
    false,
    "snapshot().lastPress, after the press this scenario made",
  );
  const lastPress = s.lastPress;
  if (lastPress !== null) {
    assertEqual(typeof lastPress.x, "number", "snapshot().lastPress.x");
    assertEqual(typeof lastPress.y, "number", "snapshot().lastPress.y");
    assertEqual(typeof lastPress.at, "number", "snapshot().lastPress.at");
  }

  assertEqual(typeof s.launchClock, "number", "snapshot().launchClock");
  assertEqual(typeof s.launched, "number", "snapshot().launched");

  assertLength(
    s.flyers,
    FLYERS.length,
    "the cards this scenario put in flight",
  );
  for (const flyer of s.flyers) {
    assertEqual(typeof flyer.id, "number", "snapshot().flyers[].id");
    assertEqual(typeof flyer.suit, "string", "snapshot().flyers[].suit");
    assertEqual(typeof flyer.rank, "number", "snapshot().flyers[].rank");
    assertEqual(typeof flyer.x, "number", "snapshot().flyers[].x");
    assertEqual(typeof flyer.y, "number", "snapshot().flyers[].y");
    assertEqual(typeof flyer.vx, "number", "snapshot().flyers[].vx");
    assertEqual(typeof flyer.vy, "number", "snapshot().flyers[].vy");
  }

  assertEqual(typeof s.cascadeDone, "boolean", "snapshot().cascadeDone");
  assertEqual(typeof s.trailStamps, "number", "snapshot().trailStamps");
  assertEqual(typeof s.simTime, "number", "snapshot().simTime");
});
