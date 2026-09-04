// instrumentation/clear-table — `clearTable` empties all thirteen piles and the
// waste's set memory, and reaches nothing outside them.
//
// THE RULE. `specs/instrumentation.md`: `clearTable()` "Removes every card from
// all thirteen piles", and "`clearTable` empties all thirteen piles and the
// waste's set memory, and it leaves the flyers, the painted layer, and every gate
// alone."
//
// WHY IT IS A `broken` POINT. `openTable` — the opening move of almost every
// scenario in this suite — is `reset()`, `setScreen("playing")` and this
// operation, and it is here so that a helper says what it leaves rather than
// resting on a build's `reset` having emptied everything. A build whose
// `clearTable` misses a pile therefore leaves a stray card on the board of every
// check that poses one, and a build whose `clearTable` also clears the flyers or
// the gates would silently unpose the scenarios that set them first.
//
// SO BOTH HALVES ARE READ. All thirteen piles carry cards and the waste carries
// two sets before the clear, and every pile is required to be empty afterwards,
// named one at a time. Two cards are in flight and the four faculty gates are
// held at a mixture of on and off, and every one of those is required to be
// exactly as it stood — the flyers by id, position and velocity, so a build that
// removed them and put equal ones back is caught too.
//
// THE GATES ARE POSED TO A MIXTURE rather than all off, so a build that restores
// them to their defaults fails on the two it turned back on and a build that
// clears them all fails on the two it turned off: each wrong model reads as a
// different answer.
//
// AND THE PAINTED LAYER IS READ HERE TOO, because the sentence being quoted names
// it beside the flyers and the gates. The two posed cards are flown for a fraction
// of a second with painting on, so the layer carries stamps before the clear, and
// `trailStamps` is required to be exactly what it was afterwards.
// `instrumentation/clear-trail` decides what `clearTrail()` does, which is a
// different operation and never calls this one, so without the reading below a
// build whose `clearTable` also wiped the trail would go ungraded.
//
//
// AND THE RUN IN HAND GOES WITH THE CARDS, which the second reading below takes
// on a scenario of its own. specs/instrumentation.md: `clearTable` "clears the run
// in hand and the drop target with them, because a held run holds cards the clear
// has taken off the table". It is the operation that makes an isolated world
// possible — a held run is on no pile, so emptying the thirteen piles would
// otherwise leave a card in the hand that the board does not account for, and the
// surface carries no other way to put one down but a real release.
//
// WHAT THIS DOES NOT DECIDE. Which pile any card was on, which is
// `instrumentation/clear-pile`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { SUITS, TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  card,
  cardCenter,
  cards,
  columnCardTopLeft,
  createHarness,
  dropRect,
  faceDown,
  framesFor,
  openTable,
  pileOf,
  poseColumn,
  poseFlyer,
  poseFoundation,
  poseStock,
  poseWaste,
  rectCenter,
  type CascadeSnapshot,
  type Harness,
  type PileName,
} from "../harness";

/** The stock and the waste this scenario lays, and the waste's two sets. */
const STOCK = ["5C", "6C", "7C"] as const;
const WASTE = ["5D", "6D", "7D"] as const;
const WASTE_SETS = [1, 2] as const;

/** The seven columns, each a face-down card under a face-up one. */
const COLUMNS = [
  ["8S", "9S"],
  ["10S", "JS"],
  ["QS", "KS"],
  ["3H", "4H"],
  ["5H", "6H"],
  ["7H", "8H"],
  ["9H", "10H"],
] as const;

/**
 * How long the two cards fly before the clear, in seconds.
 *
 * Long enough that the painted layer carries stamps and short enough that neither
 * card reaches the floor or a side edge, so nothing bounces and nothing retires:
 * over a tenth of a second the faster of the two covers `21` units.
 */
const PAINT_SECONDS = 0.1;

/** The two cards left in flight across the clear, each with a velocity of its own. */
const FLYERS = [
  { x: 260, y: 200, vx: 130, vy: -70 },
  { x: 820, y: 380, vx: -210, vy: 50 },
];

/**
 * The four gates, posed to a MIXTURE.
 *
 * Two on and two off, so a build that restores them to their defaults fails on
 * the pair it turned back on and a build that clears them fails on the pair it
 * turned off.
 */
const GATES = [
  { pose: "setAutoFlip", field: "autoFlip", value: false },
  { pose: "setWinDetect", field: "winDetect", value: true },
  { pose: "setLaunching", field: "launching", value: false },
  { pose: "setTrailPainting", field: "trailPainting", value: true },
] as const;

/** The thirteen piles, under the names `specs/instrumentation.md` addresses them by. */
const PILES: readonly { key: string; pile: PileName; index: number }[] = [
  { key: "the stock", pile: "stock", index: 0 },
  { key: "the waste", pile: "waste", index: 0 },
  ...SUITS.map((_, index) => ({
    key: `foundation ${index}`,
    pile: "foundation" as PileName,
    index,
  })),
  ...Array.from({ length: TABLEAU_COLUMNS }, (_, index) => ({
    key: `column ${index}`,
    pile: "tableau" as PileName,
    index,
  })),
];

/** Every card in flight as `"id@x,y v vx,vy"`, so a replaced flyer reads as a change. */
function flight(s: CascadeSnapshot): string {
  return s.flyers
    .map((f) => `${f.id}@${f.x},${f.y} v${f.vx},${f.vy}`)
    .join(" | ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties every pile and the set memory, and leaves the flight and the gates", async () => {
  await openTable(h);
  await poseStock(h, faceDown(...STOCK));
  await poseWaste(h, cards(...WASTE), [...WASTE_SETS]);
  for (const [index, suit] of SUITS.entries()) {
    await poseFoundation(h, index, suit, index + 1);
  }
  for (const [index, column] of COLUMNS.entries()) {
    await poseColumn(h, index, [card(column[0], false), card(column[1])]);
  }
  for (const flyer of FLYERS) await poseFlyer(h, flyer);
  for (const gate of GATES) await h.debug[gate.pose](gate.value);

  // Painting is one of the four gates posed on, so flying the two cards for a
  // moment is what puts stamps on the layer the clear must leave alone.
  await h.advance(framesFor(PAINT_SECONDS));

  const before = await h.snapshot();
  const inFlight = flight(before);
  assertGreaterThan(
    before.trailStamps,
    0,
    `stamps on the painted layer before the clear — an unpainted layer would ` +
      `say nothing about leaving it alone`,
  );
  for (const place of PILES) {
    assertEqual(
      pileOf(before, place.pile, place.index).length > 0,
      true,
      `whether ${place.key} was carrying cards before the clear — an empty ` +
        `pile would say nothing about emptying it`,
    );
  }

  await h.debug.clearTable();

  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a clear that reached too far still leaves the
  // picture of the cleared table with its flight over it.
  await captureStill(h, "cleared");

  for (const place of PILES) {
    assertLength(
      pileOf(after, place.pile, place.index),
      0,
      `the cards on ${place.key} after clearTable()`,
    );
  }
  assertLength(
    after.wasteSets,
    0,
    `the waste's set memory after clearTable(), which empties it with the ` +
      `cards (specs/instrumentation.md)`,
  );

  assertEqual(
    flight(after),
    inFlight,
    `the cards in flight after clearTable(), against the two that were flying ` +
      `before it — the clear leaves the flyers alone ` +
      `(specs/instrumentation.md)`,
  );

  assertEqual(
    after.trailStamps,
    before.trailStamps,
    `the stamps on the painted layer after clearTable(), against the ` +
      `${String(before.trailStamps)} it carried before it — the clear leaves ` +
      `the painted layer alone (specs/instrumentation.md)`,
  );

  for (const gate of GATES) {
    assertEqual(
      after[gate.field],
      gate.value,
      `snapshot().${gate.field} after clearTable(), against the ` +
        `${gate.value} it was posed to — the clear leaves every gate alone ` +
        `(specs/instrumentation.md)`,
    );
  }
});

/**
 * The two columns the run is carried between for the second reading.
 *
 * The source holds a face-down card under one face-up card, so the press lifts
 * exactly one card and leaves the column standing; the target's lowest card is
 * the red six, which `specs/tableau.md` has accept the black five, so a drop
 * target really is resolved.
 */
const HAND_FROM = 0;
const HAND_TO = 1;
const HAND_FROM_CARDS = [card("9C", false), card("5S")] as const;
const HAND_TO_CARDS = [card("6H")] as const;

it("clears the run in hand and the drop target with the cards", async () => {
  await openTable(h);
  await poseColumn(h, HAND_FROM, [...HAND_FROM_CARDS]);
  await poseColumn(h, HAND_TO, [...HAND_TO_CARDS]);

  // The press lifts the column's face-up card, which enters the hand on the press
  // itself (specs/controls.md), and one move carries that card's centre into the
  // neighbouring column's drop rectangle so a target is resolved.
  const grabbed = columnCardTopLeft(
    HAND_FROM,
    HAND_FROM_CARDS.length - 1,
    HAND_FROM_CARDS.map((c) => c.faceUp ?? true),
  );
  const press = cardCenter(grabbed.x, grabbed.y);
  await h.debug.pointerDown(press.x, press.y);
  const lifted = (await h.snapshot()).drag;
  assertEqual(
    lifted === null,
    false,
    `whether the press on column ${HAND_FROM}'s face-up card lifted nothing ` +
      `— a run enters the hand on the press itself (specs/controls.md), and ` +
      `this reading cannot clear a hand that was never filled`,
  );
  const held = lifted ?? { x: press.x, y: press.y };
  const centre = cardCenter(held.x, held.y);
  const target = rectCenter(
    dropRect(
      "tableau",
      HAND_TO,
      HAND_TO_CARDS.map((c) => c.faceUp ?? true),
    ),
  );
  await h.debug.pointerMove(
    press.x + (target.x - centre.x),
    press.y + (target.y - centre.y),
  );
  assertEqual(
    (await h.snapshot()).dropTarget === null,
    false,
    `whether a drop target was resolved with the held card's centre inside ` +
      `column ${HAND_TO}'s drop rectangle over a card that accepts it ` +
      `(specs/controls.md, specs/tableau.md) — an unresolved target would say ` +
      `nothing about clearing one`,
  );

  await h.debug.clearTable();

  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a clear that left a card in hand still leaves the
  // picture of the board it drew.
  await captureStill(h, "cleared");

  assertEqual(
    after.drag,
    null,
    `snapshot().drag after clearTable() — the clear takes the run in hand ` +
      `with the cards it took off the table (specs/instrumentation.md)`,
  );
  assertEqual(
    after.dropTarget,
    null,
    `snapshot().dropTarget after clearTable() — the target a release would ` +
      `have landed on goes with the run (specs/instrumentation.md)`,
  );
});
