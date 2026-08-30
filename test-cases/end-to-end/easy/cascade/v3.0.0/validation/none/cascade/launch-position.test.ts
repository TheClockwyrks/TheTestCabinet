// cascade/launch-position — a card launches from its foundation's anchor.
//
// specs/victory.md fixes a launched card's top-left as "the anchor of the
// foundation it launched from, as `specs/table.md` fixes it", and adds that "a
// card launched in a frame takes no motion in that frame" — so on the frame a
// card launches its position is that anchor exactly, with nothing integrated on
// top of it.
//
// THE FIRST FOUR LAUNCHES ARE READ, AND EACH AGAINST ITS OWN FOUNDATION.
// `specs/table.md` puts the four foundations at four different `x` (`590`, `712`,
// `834`, `956`), so four readings make the anchor the distinguishing value: a
// build that launched every card from one slot, or from the stock's anchor, or
// from the card's own centre rather than its top-left, reads a different number
// at three of the four rather than agreeing by luck at one. Which foundation a
// card came from is FOUND by `readLaunches` rather than assumed, so a build that
// cycles the slots in another order still has its anchors read correctly here.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { FOUNDATION_COUNT, FOUNDATION_X, TOP_ROW_Y } from "../constants";
import { type Harness, captureStill, createHarness } from "../harness";
import { openCascade, readLaunches } from "./flight";

/**
 * How far a launched card's top-left may sit from its anchor, in logical units.
 *
 * The anchor is ASSIGNED rather than integrated — the card takes no motion on
 * the frame it launches — so the only slack the reading needs is the rounding of
 * a double through JSON. A millionth of a unit is eleven orders of magnitude
 * below the `122` that separates two foundation anchors.
 */
const ANCHOR_TOLERANCE = 1e-6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("puts a launched card's top-left at its foundation's anchor", async () => {
  await openCascade(harness);

  const launches = await readLaunches(harness, FOUNDATION_COUNT);
  await captureStill(harness, "launch");

  for (const launch of launches) {
    const anchorX = FOUNDATION_X[launch.foundation];
    assertLessThanOrEqual(
      Math.abs(launch.flyer.x - anchorX),
      ANCHOR_TOLERANCE,
      `the x of the card launch ${launch.ordinal} took from foundation ${launch.foundation}, whose anchor is ${anchorX}`,
    );
    assertLessThanOrEqual(
      Math.abs(launch.flyer.y - TOP_ROW_Y),
      ANCHOR_TOLERANCE,
      `the y of the card launch ${launch.ordinal} took from foundation ${launch.foundation}, whose anchor is ${TOP_ROW_Y}`,
    );
  }
});
