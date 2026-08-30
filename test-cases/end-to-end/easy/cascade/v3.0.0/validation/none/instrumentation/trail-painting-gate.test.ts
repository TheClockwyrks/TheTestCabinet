// instrumentation/trail-painting-gate — with the trail's painting gated off a
// second of flight leaves no mark on the table and `trailStamps` where it was,
// while the card still moves and is still drawn; with the gate on the same second
// raises `trailStamps`.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates:
// `setTrailPainting(enabled)` gates "The stamping of a card in flight onto the
// painted layer. Off, the layer takes no new stamp and `trailStamps` stops
// rising. The cards still fly and are still drawn at their positions."
// `specs/victory.md` puts the stamp in the frame it belongs to: step 4 of every
// in-flight card's frame is "The card is stamped onto the painted layer at its
// position."
//
// WHY IT IS ITS OWN POINT. The gate is what makes a cascade replay readable at
// all — a frame carrying a full-stage blit is a frame a recording cannot afford
// many of — so the checks that record the flight turn it off and read the cards
// alone. A build that ignores it would bury those recordings, and a build that
// took the gate to mean "stop the cascade" would empty them.
//
// THREE READINGS, AND THE LAST TWO ARE WHAT SEPARATE THE WRONG MODELS. A build
// that stops the whole cascade when the gate goes off holds `trailStamps` still
// exactly as a correct build does, so the gated second also reads the card's
// travel and the frame's own drawing: the card must have moved along `x`, and the
// frame must still have painted a card-sized shape at the position the snapshot
// reports for it. A build that merely stops COUNTING while it goes on stamping is
// caught by the third reading, which is of the table itself.
//
// THE TABLE IS READ AS PIXELS, over the rectangle the card was posed on and left.
// `specs/overview.md` requires that "A card of either face reads apart from the
// table it sits on", so a stamp is a large colour change and its absence is none
// at all — which is what makes the two thresholds below so far apart.
//
// AND THE GATE IS THEN PUT BACK ON, over a second of the same flight, so a build
// that never paints at all fails here rather than passing on a gate it ignores.
// That second is also the control for the pixel reading: it is the same rectangle,
// read again, and it must now be unmistakably marked.
//
// WHAT THIS DOES NOT DECIDE. That a stamp PERSISTS as the card moves on, that the
// painted area grows, or that the table stays painted once the cascade is done —
// `cascade/trail-persists`, `cascade/trail-accumulates` and
// `cascade/trail-survives-completion` grade those. Nor how far the card travelled,
// which is `cascade/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertGreaterThanOrEqual,
  assertNotEqual,
} from "../assert";
import { CARD_H, CARD_W, FLOOR_Y, STAGE_W } from "../constants";
import {
  captureStill,
  cardFootprints,
  createHarness,
  framesFor,
  gridPoints,
  openTable,
  poseFlyer,
  requireFlyer,
  type Harness,
  type Rect,
} from "../harness";

/** The span each half of this point runs for, in seconds. */
const SPAN_SECONDS = 1;

/**
 * Where the card is posed, and the rectangle the table is read over.
 *
 * The rectangle is that card's own footprint. It sits left of `STOCK_X` (`224`)
 * and above the columns, so nothing but a stamp is ever drawn there, and it is
 * the first place a stamping build would mark.
 */
const START = { x: 100, y: 100 };
const READ_RECT: Rect = { x: START.x, y: START.y, w: CARD_W, h: CARD_H };

/**
 * The gated card's horizontal speed, in logical units per second.
 *
 * `700` carries it from `100` to `800` over the second — right off the read
 * rectangle, so the reading is of the table rather than of the card, and still
 * `380` units clear of the right edge `specs/victory.md` retires a card past.
 */
const GATED_VX = 700;

/** How finely the read rectangle is sampled: twelve points, none on an edge. */
const SAMPLE_COLS = 3;
const SAMPLE_ROWS = 4;

/**
 * The largest colour distance an UNMARKED table may show, against the same
 * rectangle read before the flight.
 *
 * `8` on a scale that runs to about `441`. Both readings are the same build
 * drawing a state the specification says is the same, so the only distance is the
 * rasterizer's own; this is that noise floor with room to spare, and it is a
 * twentieth of what a card over felt gives, since `specs/overview.md` requires
 * that a card of either face read apart from the table it sits on.
 */
const CLEAN_DISTANCE = 8;

/**
 * The smallest MEAN colour distance a MARKED table must show over the same
 * rectangle.
 *
 * `24`, a weak floor rather than a measurement: `specs/overview.md` requires a
 * card to read apart from the table "at a glance", and a build whose card ground
 * were within `24` of its felt would fail the `presentation` group's own
 * legibility points long before it reached this one. It is three times
 * `CLEAN_DISTANCE`, so the two readings cannot be confused.
 */
const PAINTED_DISTANCE = 24;

/**
 * How far a drawn card-sized shape may sit from the position the snapshot
 * reports for the card, in logical units, and how far its size may be from
 * `CARD_W x CARD_H`.
 *
 * `3` units. `specs/table.md` fixes the footprint and says nothing about how a
 * card is drawn, so this admits a build whose outer plate is inset or outlined by
 * a unit or two; it is well under `FACE_UP_OFFSET_MIN` (`14`), the smallest
 * distance the case ever puts between two cards, so it can merge no two readings.
 */
const DRAW_SLACK = 3;

/** The colour distance between two sampled pixels. */
function distance(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes no stamp with the gate off while the card flies and is drawn, and stamps with it on", async () => {
  await openTable(h);
  // The cascade runs on the `won` screen (`specs/victory.md`); the table under
  // it is empty, so nothing but the posed card is ever drawn or stamped.
  await h.debug.setScreen("won");
  await h.advance(1);

  const points = gridPoints(READ_RECT, SAMPLE_COLS, SAMPLE_ROWS);
  const bare = await h.pixels(points);

  // ---- The gated second ----------------------------------------------------

  await h.debug.setTrailPainting(false);
  if (START.x + GATED_VX * SPAN_SECONDS > STAGE_W - CARD_W || START.y > FLOOR_Y) {
    throw new RangeError(
      `cascade: a card posed at (${START.x}, ${START.y}) with vx ${GATED_VX} ` +
        `does not stay clear of the edges for ${SPAN_SECONDS} s`,
    );
  }
  const id = await poseFlyer(h, { x: START.x, y: START.y, vx: GATED_VX, vy: 0 });
  const before = await h.snapshot();

  await h.advance(framesFor(SPAN_SECONDS));
  const gated = await h.snapshot();
  const gatedPixels = await h.pixels(points);

  // One more frame, kept, so the drawing that frame issued can be read beside
  // the position the same frame left the card at.
  const calls = await h.frameCalls();
  const drawn = requireFlyer(
    await h.snapshot(),
    id,
    "reading where the frame drew the card in flight",
  );
  const footprints = cardFootprints(calls, DRAW_SLACK);
  const nearest = footprints.reduce(
    (best, at) =>
      Math.max(Math.abs(at.x - drawn.x), Math.abs(at.y - drawn.y)) < best.miss
        ? { miss: Math.max(Math.abs(at.x - drawn.x), Math.abs(at.y - drawn.y)), at }
        : best,
    { miss: Number.POSITIVE_INFINITY, at: { x: NaN, y: NaN } },
  );

  // Before the assertions, so a stamp that should not be there still leaves the
  // picture of the table the gated second produced.
  await captureStill(h, "gated");

  // ---- The same second with the gate on ------------------------------------

  await h.debug.setTrailPainting(true);
  await h.debug.clearFlyers();
  // At rest on the read rectangle, so the second the gate is on is the second
  // that marks the rectangle the first one left clean.
  await poseFlyer(h, { x: START.x, y: START.y, vx: 0, vy: 0 });
  await h.advance(framesFor(SPAN_SECONDS));
  const painted = await h.snapshot();
  const paintedPixels = await h.pixels(points);

  // ---- The readings --------------------------------------------------------

  assertEqual(
    gated.trailStamps,
    before.trailStamps,
    `snapshot().trailStamps after ${SPAN_SECONDS} s of flight with ` +
      `setTrailPainting(false), against the count before it — the layer takes ` +
      `no new stamp and the count stops rising (specs/instrumentation.md)`,
  );

  assertNotEqual(
    gated.flyers.find((f) => f.id === id)?.x,
    START.x,
    `the x of the card in flight over that second, which is where it was ` +
      `posed — the cards still fly with the gate off ` +
      `(specs/instrumentation.md), and a build that stopped the cascade ` +
      `instead would hold trailStamps still for the wrong reason`,
  );

  assertLessThanOrEqual(
    nearest.miss,
    DRAW_SLACK,
    `how far the nearest card-sized shape the frame painted sits from the ` +
      `(${drawn.x.toFixed(1)}, ${drawn.y.toFixed(1)}) the snapshot reports ` +
      `for the card, in logical units — the cards are still DRAWN at their ` +
      `positions with the gate off (specs/instrumentation.md); the frame ` +
      `painted ${footprints.length} card-sized shape(s) in all`,
  );

  assertLessThanOrEqual(
    Math.max(...gatedPixels.map((p, i) => distance(p, bare[i]))),
    CLEAN_DISTANCE,
    `the largest colour distance across ${points.length} points of the ` +
      `rectangle the card was posed on and flew off, against the same points ` +
      `read before the flight — with the gate off the layer takes no new stamp ` +
      `(specs/instrumentation.md), so the table is exactly as it was`,
  );

  assertGreaterThan(
    painted.trailStamps,
    gated.trailStamps,
    `snapshot().trailStamps after the same second with setTrailPainting(true), ` +
      `against the count the gated second left — a build that never paints ` +
      `fails here rather than passing on a gate it ignores`,
  );
  assertGreaterThanOrEqual(
    paintedPixels
      .map((p, i) => distance(p, bare[i]))
      .reduce((total, d) => total + d, 0) / paintedPixels.length,
    PAINTED_DISTANCE,
    `the mean colour distance across the same ${points.length} points once ` +
      `the gate was on, against the bare table — a card of either face reads ` +
      `apart from the table it sits on (specs/overview.md), so a stamp is a ` +
      `large change and this reading is what says the pixels above could have ` +
      `caught one`,
  );
});
