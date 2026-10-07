// instrumentation/trail-painting-gate-off — with the trail's painting gated off,
// the gate reads back off and a second of flight leaves no mark on the table and
// `trailStamps` where it was, while the card still moves and is still drawn.
//
// THE RULE. specs/instrumentation.md, The faculty gates:
// `setTrailPainting(enabled)` gates "The stamping of a card in flight onto the
// painted layer. Off, the layer takes no new stamp and `trailStamps` stops
// rising. The cards still fly and are still drawn at their positions."
// specs/victory.md puts the stamp in the frame it belongs to: step 4 of every
// in-flight card's frame is "The card is stamped onto the painted layer at its
// position."
//
// WHY THE OFF DIRECTION IS ITS OWN POINT. A switch that never turns the painting
// off makes a cascade replay unreadable — a frame carrying a full-stage blit is a
// frame a recording cannot afford many of, so the checks that record the flight
// turn it off and read the cards alone — and that is a different cost from a
// switch that never turns the painting back on, which is
// `instrumentation/trail-painting-gate-on`.
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
// specs/overview.md requires that "A card of either face reads apart from the
// table it sits on", so a stamp is a large colour change and its absence is none
// at all — which is what makes the two thresholds below so far apart.
//
// A BUILD THAT NEVER PAINTS AT ALL passes this direction and fails
// `instrumentation/trail-painting-gate-on`, which is the point that reads a stamp
// really being laid. That is what one requirement in one direction means.
//
// WHAT THIS DOES NOT DECIDE. That a stamp PERSISTS as the card moves on, that the
// painted area grows, or that the table stays painted once the cascade is done —
// `cascade/trail-persists`, `cascade/trail-accumulates` and
// `cascade/trail-survives-completion` grade those. Nor how far the card travelled,
// which is `cascade/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CARD_H, CARD_W, LAUNCH_VX_MAX } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  flyerById,
  KING,
  openTable,
  pixelsChanged,
  poseFlyer,
  regionPixels,
  type Harness,
} from "../harness";

/**
 * The band of felt the reading is taken from: below the empty-slot marks, which
 * end at `y = 320`, and above the HUD strip at `y = 680` (specs/table.md).
 */
const PROBE = { x: 280, y: 340, w: 200, h: 200 };

/**
 * The card in flight, posed to the LEFT of the probe band and carried across it
 * and out to its right at `LAUNCH_VX_MAX`, the fastest a launched card may travel
 * (specs/victory.md draws `vx` uniformly from `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]`):
 * `x` runs from `150` to `570` over the second, and a card is `CARD_W` (`100`)
 * wide, so its footprint clears the band's `280..480` at both ends of the reading.
 */
const FLYER = {
  spec: card("hearts", KING),
  x: 150,
  y: 400,
  vx: LAUNCH_VX_MAX,
  vy: 0,
};

/** How long the card is left flying. */
const FLIGHT_SECONDS = 1;

/** Pose the won table, the gate, and the card in flight; hand back the id. */
function poseFlight(harness: Harness, painting: boolean): number {
  openTable(harness);
  harness.debug.setScreen("won");
  harness.debug.setTrailPainting(painting);
  return poseFlyer(harness, FLYER.spec, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes no stamp over a second of flight with the gate off, while the card moves and is drawn", async () => {
  const flyerId = poseFlight(h, false);
  await h.drawFrame();
  const clean = regionPixels(h, PROBE);
  const before = h.snapshot();

  await h.advanceSeconds(FLIGHT_SECONDS);
  const after = h.snapshot();

  await h.drawFrame();
  captureStill(h, "gated");
  const drawn = h.snapshot();

  assertEqual(
    after.trailStamps,
    before.trailStamps,
    `stamps reported after ${FLIGHT_SECONDS} s of flight with ` +
      "setTrailPainting(false): off, trailStamps stops rising " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    pixelsChanged(clean, regionPixels(h, PROBE)),
    0,
    "pixels differing from the clean table in the band the card flew " +
      "through, with the gate off: the layer takes no new stamp " +
      "(specs/instrumentation.md)",
  );

  assertGreaterThan(
    flyerById(after, flyerId)?.x ?? Number.NEGATIVE_INFINITY,
    FLYER.x,
    "how far right the card reached, having been posed at " +
      `x = ${FLYER.x} with vx = ${FLYER.vx}: the cards still fly ` +
      "(specs/instrumentation.md)",
  );

  // Still drawn: the card's own footprint on the frame just drawn, against the
  // same footprint with the card taken out of the flight and the frame drawn
  // again.
  const flyer = flyerById(drawn, flyerId);
  const footprint = {
    x: flyer?.x ?? 0,
    y: flyer?.y ?? 0,
    w: CARD_W,
    h: CARD_H,
  };
  const withCard = regionPixels(h, footprint);
  h.debug.removeFlyer(flyerId);
  await h.drawFrame();
  assertGreaterThan(
    pixelsChanged(withCard, regionPixels(h, footprint)),
    0,
    "pixels the card in flight put inside its own footprint, with the gate " +
      "off: the cards are still drawn at their positions " +
      "(specs/instrumentation.md)",
  );
});
