// handling/held-run-follows-pointer — a held run travels exactly as far as the
// pointer does.
//
// THE RULE. specs/controls.md: "The run holds the position the pointer gives it:
// it keeps the offset between the press point and the leading card's top-left, so
// the run travels exactly as far as the pointer does." specs/instrumentation.md
// reports that position as `drag.x`/`drag.y`, "the top-left of `cards[0]`", in
// the stage's logical units.
//
// So the reading at every sample is one subtraction: the run's reported top-left
// less the pointer's position must equal the offset the press fixed, and it must
// equal it at each of the sweep's points and not merely at the end of it.
//
// THE PRESS IS DELIBERATELY OFF-CENTRE. Pressed at the card's centre, "keep the
// offset" and "centre the card on the pointer" are the same rule and the check
// would decide nothing. The press lands `20` units right and `30` units down from
// the card's top-left instead, so the three models separate by tens of units:
//
//   keeps the press offset (the rule)   ->  top-left at pointer - (20, 30)
//   centres the card on the pointer     ->  top-left at pointer - (50, 70)
//   puts the top-left at the pointer    ->  top-left at pointer
//
// THE SWEEP CROSSES THE TABLE and returns, so a build that follows on one axis,
// or that clamps the run to the stage, or that only re-reads the pointer when it
// enters a pile, is caught at one of the samples.
//
// THE TABLE HOLDS ONE CARD, and it is the card in hand, so the sweep passes over
// bare felt and nothing it crosses can move. The run is never released, because
// what a release does belongs to the four items that decide a release.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertNotNull } from "../assert";
import { COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureReplay,
  card,
  createHarness,
  KING,
  movePointerTo,
  openTable,
  poseColumn,
  pressAt,
  type Harness,
  type Point,
  type SnapshotDrag,
} from "../harness";

/** The column the card is posed on, and the card. Neither decides anything. */
const COLUMN = 3;
const CARDS = [card("spades", KING)];

/**
 * Where on the card the press lands, measured from its top-left. Both are away
 * from the card's centre — `CARD_W / 2` is `50` and `CARD_H / 2` is `70`
 * (specs/table.md) — so a build that centres the run on the pointer reads `30`
 * units off in `x` and `40` off in `y`.
 */
const PRESS_DX = 20;
const PRESS_DY = 30;

/** The pointer's path after the press, in the stage's logical units. */
const SWEEP: readonly Point[] = [
  { x: 300, y: 480 },
  { x: 900, y: 300 },
  { x: 700, y: 620 },
  { x: 400, y: 200 },
  { x: 640, y: 360 },
];

/**
 * How closely the reported top-left must sit on the offset the press fixed, as
 * decimal places for `assertCloseTo` (so `6` is half of `1e-6` of a unit).
 *
 * The rule is exact: the run travels exactly as far as the pointer. The only
 * slack a conformant build can need is the rounding of adding five displacements
 * to a coordinate of a few hundred, which is some twelve orders of magnitude
 * smaller than this. Nothing a player could see fits inside it: the stage is
 * `1280` units wide and the smallest distance the case names anywhere is
 * `DRAG_THRESHOLD` (`5`).
 */
const POSITION_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the offset the press fixed at every point of a sweep", async () => {
  openTable(h);
  poseColumn(h, COLUMN, CARDS);

  // The card is the column's only one, so it is drawn at the column's anchor
  // (specs/table.md), and the press lands inside its 100x140 footprint.
  const press = { x: COLUMN_X[COLUMN] + PRESS_DX, y: TABLEAU_Y + PRESS_DY };
  pressAt(h, press.x, press.y);

  const lifted = h.snapshot().drag;
  assertNotNull(
    lifted,
    `the run in hand after a press ${String(PRESS_DX)} units right and ` +
      `${String(PRESS_DY)} units down from the card's top-left, which lifts it ` +
      "(specs/controls.md)",
  );

  const readings = await captureReplay(h, "sweep", async () => {
    const seen: { point: Point; drag: SnapshotDrag | null }[] = [];
    for (const point of SWEEP) {
      movePointerTo(h, point.x, point.y);
      await h.advance(1);
      seen.push({ point, drag: h.snapshot().drag });
    }
    return seen;
  });

  // The offset the press fixed, read off the run as it entered the hand: the
  // leading card's top-left less the press point (specs/controls.md).
  const offsetX = (lifted?.x ?? 0) - press.x;
  const offsetY = (lifted?.y ?? 0) - press.y;

  readings.forEach(({ point, drag }, i) => {
    const where = `sample ${String(i + 1)} at (${String(point.x)}, ${String(point.y)})`;
    assertNotNull(
      drag,
      `${where}: the run is still in hand (specs/controls.md)`,
    );
    assertCloseTo(
      drag?.x ?? Number.NaN,
      point.x + offsetX,
      POSITION_DIGITS,
      `${where}: drag.x, the leading card's top-left, which keeps the offset ` +
        `of ${String(offsetX)} the press fixed (specs/controls.md)`,
    );
    assertCloseTo(
      drag?.y ?? Number.NaN,
      point.y + offsetY,
      POSITION_DIGITS,
      `${where}: drag.y, the leading card's top-left, which keeps the offset ` +
        `of ${String(offsetY)} the press fixed (specs/controls.md)`,
    );
  });

  // And the offset itself is the one the press fixed rather than one of the
  // build's choosing. specs/table.md draws a column's first card at its anchor,
  // so the press landed (PRESS_DX, PRESS_DY) inside the leading card's top-left
  // and that is the offset the run must have kept. Without this reading a build
  // that snapped the card's top-left onto the pointer would track it perfectly
  // and still have moved the card under the player's hand on the press.
  assertCloseTo(
    offsetX,
    -PRESS_DX,
    POSITION_DIGITS,
    "the x offset the press fixed, which is the press point less the leading " +
      "card's top-left (specs/controls.md)",
  );
  assertCloseTo(
    offsetY,
    -PRESS_DY,
    POSITION_DIGITS,
    "the y offset the press fixed, which is the press point less the leading " +
      "card's top-left (specs/controls.md)",
  );
});
