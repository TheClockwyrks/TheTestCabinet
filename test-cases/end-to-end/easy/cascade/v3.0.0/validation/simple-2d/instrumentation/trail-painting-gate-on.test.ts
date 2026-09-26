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
  cardCenter,
  colorDistance,
  createHarness,
  framesFor,
  openTable,
  sampleColor,
  seconds,
  type Harness,
} from "../harness";

/**
 * The card posed in flight, as its top-left and velocity in logical units.
 *
 * It starts left of `COLUMN_X[0]` (`224`) and clear of the top row, so the point
 * sampled below, its own center, lies where no pile and no screen message is drawn
 * under specs/table.md and specs/screens.md. `240` units per second to the right
 * carries it a card's width and more away from that point over the second, so what
 * is sampled afterwards is the layer rather than the card.
 */
const FLYER = { x: 40, y: 260, vx: 240, vy: -600 };

/** The second of game time the item names. */
const HOLD_FRAMES = framesFor(1);

/*
 * The painted sample only has to have MOVED from the felt sample, and nothing
 * about it is measured. The case fixes no palette, so how far a stamp reads from
 * the felt is the reviewer's; both readings are the same point of the same screen
 * drawn by the same build, so any difference at
 * all is the paint.
 */

/** Where the sample is taken: the center of the card's own starting footprint. */
const SAMPLE = cardCenter(FLYER.x, FLYER.y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open the won screen with nothing on the table, and the painting gate as given. */
async function openFlight(trailPainting: boolean): Promise<void> {
  openTable(h);
  h.debug.setScreen("won");
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(trailPainting);
  h.debug.clearTrail();
  await h.advance(1);
}

it("raises the stamp count over the same second with painting on", async () => {
  await openFlight(true);
  const felt = sampleColor(h, SAMPLE.x, SAMPLE.y);

  h.debug.addFlyer("spades", 13, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
  const before = h.snapshot();

  await h.advance(HOLD_FRAMES);

  const after = h.snapshot();
  // Before the assertions, so a layer that kept nothing still leaves the picture
  // of the table the flyer crossed.
  captureStill(h, "painted");

  assertGreaterThan(
    after.trailStamps,
    before.trailStamps,
    `stamps on the painted layer after ${seconds(HOLD_FRAMES)} s of flight ` +
      "with trailPainting on (specs/victory.md)",
  );
  assertGreaterThan(
    colorDistance(sampleColor(h, SAMPLE.x, SAMPLE.y), felt),
    0,
    `the table at (${SAMPLE.x}, ${SAMPLE.y}), which the card flew over: with ` +
      "the gate on the layer keeps its stamps (specs/victory.md)",
  );
});
