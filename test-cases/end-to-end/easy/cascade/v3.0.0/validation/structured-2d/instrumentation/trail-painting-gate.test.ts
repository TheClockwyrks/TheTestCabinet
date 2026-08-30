// instrumentation/trail-painting-gate — `setTrailPainting` stops the stamping,
// and stops nothing else.
//
// THE RULE. specs/instrumentation.md, under The faculty gates:
// `setTrailPainting(enabled)` gates "the stamping of a card in flight onto the
// painted layer. Off, the layer takes no new stamp and `trailStamps` stops
// rising. The cards still fly and are still drawn at their positions."
//
// WHY A SCENARIO NEEDS THE GATE AT ALL. The painted layer is a full-screen
// surface a card stamps itself onto every frame and which is never cleared
// while the cascade runs (specs/victory.md), so a check that wants to look at
// the table underneath a flight — or to record one without a full-screen blit
// in every frame — has to be able to hold the painting still.
//
// THREE READINGS WITH THE GATE OFF, AND ONE WITH IT ON.
//   Off: `trailStamps` is exactly where it was; the band of felt the card flew
//   through is pixel-for-pixel the clean table it was before the flight; and
//   the card itself has both MOVED and is still DRAWN where it now is.
//   On: the same second over the same pose raises `trailStamps`.
// The last of those is what makes the first three a gate rather than a build
// that never painted at all.
//
// THE BAND READ IS BARE FELT ON AN EMPTY TABLE, AND THE CARD IS NEVER IN IT
// WHEN IT IS READ. The thirteen empty-slot marks specs/table.md fixes end at
// `y = 320` — a column's first card is `140` tall from `y = 180` — and the HUD
// strip begins at `y = 680`, so `y = 340` to `y = 540` across the left of the
// table carries nothing. The card is posed to the LEFT of the band and carried
// out to its RIGHT, so it stands outside the probe both when the band is read
// before the flight and when it is read after: whatever differs between those
// two readings is a stamp, and the comparison is against the same table one
// second earlier rather than against a colour this point would otherwise be
// fixing.
//
// "STILL DRAWN" IS READ WITHOUT DEMANDING A CONTRAST. The card's own footprint
// is compared with the same footprint after the card has been removed and the
// frame redrawn, so what the reading says is that something was drawn there —
// not how strongly it stood out, which is
// `presentation.face-distinct-from-table`.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_H, CARD_W } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  KING,
  captureStill,
  card,
  createHarness,
  flyerById,
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

it("raises the stamp count over the same second with the gate on", async () => {
  poseFlight(h, true);
  const before = h.snapshot();

  await h.advanceSeconds(FLIGHT_SECONDS);
  const after = h.snapshot();

  assertGreaterThan(
    after.trailStamps,
    before.trailStamps,
    `stamps reported after the same ${FLIGHT_SECONDS} s of flight with the ` +
      "gate on: a card in flight is stamped onto the painted layer " +
      "(specs/victory.md)",
  );
});
