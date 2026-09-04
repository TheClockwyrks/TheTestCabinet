// instrumentation/trail-painting-gate-on — with the trail's painting gated back
// on, the gate reads back on and a second of the same flight raises
// `trailStamps`.
//
// THE RULE. specs/instrumentation.md, The faculty gates:
// `setTrailPainting(enabled)` gates "The stamping of a card in flight onto the
// painted layer", and each gate "is reported by `snapshot`". specs/victory.md
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
// pixels before the flight and after it. specs/overview.md requires that "A
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
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  card,
  createHarness,
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
 * and out to its right: `x` runs from `150` to `650` over the second, and a
 * card is `CARD_W` (`100`) wide, so its footprint clears the band's `280..480`
 * at both ends of the reading.
 */
const FLYER = { spec: card("hearts", KING), x: 150, y: 400, vx: 500, vy: 0 };

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

it("raises the stamp count and paints the table over the same second with the gate on", async () => {
  const flyerId = poseFlight(h, true);
  await h.drawFrame();
  const clean = regionPixels(h, PROBE);
  const before = h.snapshot();

  await h.advanceSeconds(FLIGHT_SECONDS);
  const after = h.snapshot();

  // The card is taken out of the flight before the band is read again, so what
  // the reading finds in it is the layer the flight painted and never the card
  // itself. It flew clear of the band anyway — its footprint ends at `750` —
  // and removing it puts that beyond doubt.
  h.debug.removeFlyer(flyerId);
  await h.drawFrame();
  captureStill(h, "painted");

  assertGreaterThan(
    after.trailStamps,
    before.trailStamps,
    `stamps reported after the same ${FLIGHT_SECONDS} s of flight with the ` +
      "gate on: a card in flight is stamped onto the painted layer " +
      "(specs/victory.md)",
  );
  assertGreaterThan(
    pixelsChanged(clean, regionPixels(h, PROBE)),
    0,
    "pixels differing from the clean table in the band the card flew " +
      "through, with the gate on: the stamp is on the table and not only in " +
      "the count (specs/victory.md, specs/instrumentation.md)",
  );
});
