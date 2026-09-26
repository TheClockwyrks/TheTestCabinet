// cascade/foundations-drawn-beneath — the unlaunched cards stay drawn in place.
//
// specs/victory.md, on the painted layer and what sits above it: "The cards that
// have not launched yet stay drawn at their foundation anchors while the cascade
// runs above them." A build that stops drawing the table's remaining cards the
// moment the ending begins leaves three quarters of the deck invisible for the
// nine seconds the cascade takes to launch them.
//
// WHAT IS READ. The card-sized shapes the frame painted, at the four anchors
// `specs/table.md` fixes for the foundations (`590`, `712`, `834`, `956`, each at
// `TOP_ROW_Y`). A card's footprint is `CARD_W x CARD_H` wherever it sits, so a
// shape of that size at an anchor is the pile drawn there.
//
// THE CARDS IN FLIGHT ARE COUNTED OUT OF THE READING. A card launches FROM an
// anchor and takes no motion on the frame it launches (`specs/victory.md`), so on
// such a frame a flyer is drawn exactly over the anchor it came from, and a
// reading that counted it would say the foundation was drawn when it was not.
// So each anchor is read as a COUNT: the card-sized shapes the frame painted
// there must outnumber the flyers the snapshot reports there. Counting rather
// than filtering is what keeps a conformant build safe on the one frame where a
// flyer and the pile beneath it share an anchor — dropping every footprint at
// that anchor would drop the pile's own along with the flyer's. It also decouples
// the reading from the launch velocities entirely.
//
// WHAT THIS READING CANNOT TELL APART, stated plainly: `specs/overview.md`
// requires an empty pile to read "as an empty slot at its anchor", so a
// card-sized shape at a foundation anchor is either the pile's top card or a slot
// mark, and from the outside the two are the same shape. A build that drew the
// slots and forgot the cards would pass. Nothing observable from here separates
// the two without demanding a way of drawing a card that the specification does
// not fix — a rank drawn as text rather than as paths, an empty slot carrying no
// mark of its own — and a check that demanded either would fail conformant
// builds. So the reading is taken one second in, when all four foundations still
// hold eleven or more cards each, and the still is what a reviewer looks at.
// Whether what is drawn READS as a card is the `presentation` group's question
// and is not decided again here.
//
// The painting stays off, per this group's rule: the trail is not needed to
// decide this, and a full-stage blit under the cards would only entangle two
// requirements.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { FOUNDATION_COUNT, FOUNDATION_X, TOP_ROW_Y } from "../constants";
import {
  type Harness,
  captureStill,
  cardFootprints,
  createHarness,
  framesFor,
} from "../harness";
import { openCascade } from "./flight";

/** How far into the running cascade the frame is read, in seconds. */
const INTO_THE_CASCADE = 1;

/**
 * How far a drawn shape may sit from the anchor it is read against, in logical
 * units.
 *
 * `specs/table.md` fixes the anchors exactly, and this admits a build whose
 * outer plate sits a unit or two off its nominal corner — a shadow, a border
 * drawn outside the footprint. It is sixty times smaller than the `122` that
 * separates two foundation anchors, so no shape can be read against the wrong
 * one.
 */
const ANCHOR_TOLERANCE = 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("keeps drawing the foundations at their anchors while the cascade runs", async () => {
  await openCascade(harness);
  await harness.advance(framesFor(INTO_THE_CASCADE) - 1);

  const calls = await harness.frameCalls();
  const drawn = await harness.snapshot();
  await captureStill(harness, "beneath");

  assertGreaterThan(
    drawn.launched,
    0,
    `cards launched after ${INTO_THE_CASCADE} s, so the cascade really is running over the table`,
  );

  const footprints = cardFootprints(calls, ANCHOR_TOLERANCE);
  const atAnchor = (
    places: readonly { x: number; y: number }[],
    anchorX: number,
  ): number =>
    places.filter(
      (p) =>
        Math.abs(p.x - anchorX) <= ANCHOR_TOLERANCE &&
        Math.abs(p.y - TOP_ROW_Y) <= ANCHOR_TOLERANCE,
    ).length;

  for (let index = 0; index < FOUNDATION_COUNT; index += 1) {
    const held = drawn.foundations[index].length;
    assertGreaterThan(
      held,
      0,
      `cards still on foundation ${index} when the frame was read, so there is something for it to draw`,
    );
    const anchorX = FOUNDATION_X[index];
    const shapes = atAnchor(footprints, anchorX);
    const flyers = atAnchor(drawn.flyers, anchorX);
    assertGreaterThan(
      shapes,
      flyers,
      `foundation ${index}, holding ${held} card(s), to be drawn at its anchor (${anchorX}, ${TOP_ROW_Y}) while the cascade runs — the frame painted ${shapes} card-sized shape(s) there and the snapshot reports ${flyers} card(s) in flight there, and the frame's card-sized shapes were at ${JSON.stringify(footprints)}`,
    );
  }
});
