// instrumentation/trail-painting-gate-on — with the trail's painting gated back
// on, the gate reads back on and a second of the same flight raises
// `trailStamps`.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates:
// `setTrailPainting(enabled)` gates "The stamping of a card in flight onto the
// painted layer", and each gate "is reported by `snapshot`". `specs/victory.md`
// puts the stamp in the frame it belongs to: step 4 of every in-flight card's
// frame is "The card is stamped onto the painted layer at its position."
//
// WHY THE ON DIRECTION IS ITS OWN POINT, AND WHY IT TURNS THE GATE OFF FIRST. A
// switch that never turns the painting back on leaves the trail — the thing the
// game is named for — dead in normal play, which costs the player something
// completely different from a switch that never turns it off
// (`instrumentation/trail-painting-gate-off`). Setting the gate to `true` from
// `false` rather than reading the default is what makes this a reading of the
// SWITCH: a build that ignores the operation entirely and always paints would
// otherwise pass on a value it never honoured.
//
// TWO READINGS, AND THE SECOND IS OF THE TABLE ITSELF. `trailStamps` alone would
// pass a build that counts without stamping, so the same rectangle is read as
// pixels before the flight and after it. `specs/overview.md` requires that "A
// card of either face reads apart from the table it sits on", so a stamp is a
// large colour change, which is why the floor below can be a weak one.
//
// THE CARD IS POSED AT REST ON THE READ RECTANGLE, so the second the gate is on
// is the second that marks exactly the rectangle the reading is taken over.
//
// WHAT THIS DOES NOT DECIDE. That a stamp PERSISTS as the card moves on, that the
// painted area grows, or that the table stays painted once the cascade is done —
// `cascade/trail-persists`, `cascade/trail-accumulates` and
// `cascade/trail-survives-completion` grade those.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CARD_H, CARD_W } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  gridPoints,
  openTable,
  poseFlyer,
  type Harness,
  type Rect,
} from "../harness";

/** The span the flight runs for, in seconds. */
const SPAN_SECONDS = 1;

/**
 * Where the card is posed, and the rectangle the table is read over.
 *
 * The rectangle is that card's own footprint. It sits left of `STOCK_X` (`224`)
 * and above the columns, so nothing but a stamp is ever drawn there.
 */
const START = { x: 100, y: 100 };
const READ_RECT: Rect = { x: START.x, y: START.y, w: CARD_W, h: CARD_H };

/** How finely the read rectangle is sampled: twelve points, none on an edge. */
const SAMPLE_COLS = 3;
const SAMPLE_ROWS = 4;

/*
 * A MARKED table only has to read DIFFERENTLY over that rectangle from the same
 * points read bare, and how far apart the two sit is not measured:
 * `specs/overview.md` fixes no palette, so that is the reviewer's. Each
 * point is compared against itself, so any difference at
 * all is the stamp.
 */

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

it("reports the gate on again and marks the table over a second of flight", async () => {
  await openTable(h);
  // The cascade runs on the `won` screen (`specs/victory.md`); the table under it
  // is empty, so nothing but the posed card is ever drawn or stamped.
  await h.debug.setScreen("won");
  await h.advance(1);

  const points = gridPoints(READ_RECT, SAMPLE_COLS, SAMPLE_ROWS);
  const bare = await h.pixels(points);

  // Off and then on, so what is read is the operation rather than a default.
  await h.debug.setTrailPainting(false);
  await h.debug.setTrailPainting(true);
  assertEqual(
    (await h.snapshot()).trailPainting,
    true,
    "snapshot().trailPainting after setTrailPainting(true) followed " +
      "setTrailPainting(false): each gate is reported by snapshot " +
      "(specs/instrumentation.md)",
  );

  // At rest on the read rectangle, so the second the gate is on is the second
  // that marks the rectangle read bare above.
  await poseFlyer(h, { x: START.x, y: START.y, vx: 0, vy: 0 });
  const before = await h.snapshot();

  await h.advance(framesFor(SPAN_SECONDS));
  const painted = await h.snapshot();
  const paintedPixels = await h.pixels(points);

  // Before the assertions, so a build that painted nothing still leaves the
  // picture of the table it left clean.
  await captureStill(h, "painted");

  assertGreaterThan(
    painted.trailStamps,
    before.trailStamps,
    `snapshot().trailStamps after ${SPAN_SECONDS} s of flight with ` +
      `setTrailPainting(true), against the count before it — the gate restores ` +
      `the stamping of a card in flight onto the painted layer ` +
      `(specs/instrumentation.md), so a build that never paints fails here ` +
      `rather than passing on a gate it ignores`,
  );
  assertGreaterThan(
    Math.max(...paintedPixels.map((p, i) => distance(p, bare[i]))),
    0,
    `the largest colour distance across ${points.length} points of the ` +
      `rectangle the card was posed on, against the same points read bare — ` +
      `a build that counted a stamp it never laid is caught here`,
  );
});
