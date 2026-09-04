// instrumentation/clear-table — `clearTable` empties all thirteen piles, and
// touches nothing beyond them.
//
// specs/instrumentation.md: `clearTable` "empties all thirteen piles and the
// waste's set memory, and it leaves the flyers, the painted layer, and every gate
// alone".
//
// WHY THE WHOLE SUITE RESTS ON IT. `openTable` in `harness.ts` opens every scenario
// in this project with it, and the isolation doctrine the case is written to is
// exactly this operation: a check clears the table and poses back only the cards
// its own requirement concerns. A build whose `clearTable` left a pile standing
// would run every one of those checks against a board they never asked for, and one
// that reset the gates with it would undo the very gate a check had just turned off
// to hold a faculty still.
//
// SO THE THREE THINGS IT MUST NOT TOUCH ARE ALL CARRYING SOMETHING when it is
// called: two cards are in flight, the painted layer has taken stamps from them,
// and the four gates are posed at a MIXED setting rather than all on or all off.
// The mixture is what tells the two wrong builds apart: one that turns every gate
// back on fails on the three that were off, and one that turns every gate off fails
// on the one that was on.
//
//
// AND THE RUN IN HAND GOES WITH THE CARDS, which the second reading below takes on
// a scenario of its own. specs/instrumentation.md: `clearTable` "clears the run in
// hand and the drop target with them, because a held run holds cards the clear has
// taken off the table". It is the operation that makes an isolated world possible —
// a held run is on no pile, so emptying the thirteen piles would otherwise leave a
// card in the hand that the board does not account for, and the surface carries no
// other way to put one down but a real release.
//
// NO FRAME RUNS between the reading before and the reading after, so the flyers
// compared either side are at the positions they were posed at and the only thing
// that happened to the board is the one operation this point is about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  pileOf,
  poseColumn,
  pressPoint,
  releasePoint,
  type Harness,
} from "../harness";
import { EVERY_PILE, pileName, poseFullBoard } from "./board";

/**
 * The two cards posed in flight, well inside both side edges and given no
 * horizontal drift, so neither retires while the layer is being stamped
 * (specs/victory.md).
 */
const FLYERS = [
  { suit: "spades", rank: 13, x: 300, y: 220 },
  { suit: "hearts", rank: 4, x: 800, y: 260 },
] as const;

/**
 * Frames the two are left in flight before the clear.
 *
 * A tenth of a second, which is enough for the painted layer to take stamps to be
 * left alone and short enough that neither card reaches the floor from where it was
 * posed.
 */
const PAINT_FRAMES = framesFor(0.1);

/** The gates posed before the clear: three off and one on, so neither wrong build passes. */
const GATES = {
  autoFlip: false,
  winDetect: false,
  launching: false,
  trailPainting: true,
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties every pile and the set memory, and leaves the flight, the layer and the gates", async () => {
  openTable(h);
  poseFullBoard(h);

  h.debug.setAutoFlip(GATES.autoFlip);
  h.debug.setWinDetect(GATES.winDetect);
  h.debug.setLaunching(GATES.launching);
  h.debug.setTrailPainting(GATES.trailPainting);

  h.debug.setScreen("won");
  for (const flyer of FLYERS) {
    h.debug.addFlyer(flyer.suit, flyer.rank, flyer.x, flyer.y, 0, 0);
  }
  await h.advance(PAINT_FRAMES);

  const before = h.snapshot();
  assertLength(before.flyers, FLYERS.length, "the cards in flight");
  assertGreaterThan(
    before.trailStamps,
    0,
    "stamps on the painted layer, which the clear must leave alone",
  );

  h.debug.clearTable();
  const after = h.snapshot();

  // The cleared table, with the flyers still in flight.
  await h.advance(1);
  captureStill(h, "cleared");

  for (const ref of EVERY_PILE) {
    assertLength(
      pileOf(after, ref.pile, ref.index),
      0,
      `${pileName(ref)}: clearTable empties all thirteen piles ` +
        "(specs/instrumentation.md)",
    );
  }
  assertLength(
    after.wasteSets,
    0,
    "the waste's set memory, which clearTable empties with the waste " +
      "(specs/instrumentation.md)",
  );

  assertDeepEqual(
    after.flyers,
    before.flyers,
    "the cards in flight, which clearTable leaves alone " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.trailStamps,
    before.trailStamps,
    "the stamps on the painted layer, which clearTable leaves alone " +
      "(specs/instrumentation.md)",
  );

  assertEqual(after.autoFlip, GATES.autoFlip, "autoFlip, left as it was posed");
  assertEqual(
    after.winDetect,
    GATES.winDetect,
    "winDetect, left as it was posed",
  );
  assertEqual(
    after.launching,
    GATES.launching,
    "launching, left as it was posed",
  );
  assertEqual(
    after.trailPainting,
    GATES.trailPainting,
    "trailPainting, left as it was posed",
  );
});

/**
 * The two columns the run is carried between for the second reading.
 *
 * A red five onto a black six, which specs/tableau.md has a column accept, so the
 * carry resolves a drop target as well as filling the hand.
 */
const HAND_FROM = 0;
const HAND_TO = 3;
const HAND_RUN = "5H";
const HAND_TARGET = "6S";

it("clears the run in hand and the drop target with the cards", async () => {
  openTable(h);
  poseColumn(h, HAND_FROM, [HAND_RUN]);
  poseColumn(h, HAND_TO, [HAND_TARGET]);

  // The press lifts the column's card, which enters the hand on the press itself
  // (specs/controls.md), and the move carries its centre into the other column's
  // drop rectangle so a target is resolved.
  const press = pressPoint(h.snapshot(), "tableau", HAND_FROM, 0);
  const over = releasePoint(h.snapshot(), "tableau", HAND_TO);
  h.debug.pointerDown(press.x, press.y);
  h.debug.pointerMove(over.x, over.y);

  const held = h.snapshot();
  assertNotNull(
    held.drag,
    "the run in hand before the clear, which the press put there " +
      "(specs/controls.md) — an empty hand would say nothing about clearing it",
  );
  assertNotNull(
    held.dropTarget,
    `the drop target while the ${HAND_RUN} is over column ${HAND_TO}, whose ` +
      `${HAND_TARGET} accepts it (specs/controls.md, specs/tableau.md) — an ` +
      "unresolved target would say nothing about clearing one",
  );

  h.debug.clearTable();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a clear that left a card in hand still leaves the
  // picture of the board it drew.
  captureStill(h, "cleared");

  assertNull(
    after.drag,
    "the run in hand after clearTable(): the clear takes it with the cards it " +
      "took off the table (specs/instrumentation.md)",
  );
  assertNull(
    after.dropTarget,
    "the drop target after clearTable(): it goes with the run the clear took " +
      "out of the hand (specs/instrumentation.md)",
  );
});
