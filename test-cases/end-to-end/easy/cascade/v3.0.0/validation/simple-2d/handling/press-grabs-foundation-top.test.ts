// handling/press-grabs-foundation-top — a press on a foundation lifts its top card.
//
// specs/controls.md's grab table: a press on "a foundation's top card" lifts "that
// card alone". specs/foundations.md states the same rule from the foundation's side:
// "A foundation's top card may be moved back onto a tableau column that accepts it",
// and the card beneath it becomes that foundation's top card. The run enters the
// hand on the press itself (specs/controls.md), so the gesture is one `pointerDown`
// and the reading is `snapshot().drag` immediately afterwards.
//
// THE FOUNDATION HOLDS THREE CARDS, so the rule has something to be wrong about: a
// build that lifts the pile rather than its top card reads three, and one that lifts
// the pile's bottom card reads the Ace. A foundation is a squared pile, every card
// sitting at its anchor (specs/table.md), so the press is aimed at that anchor's
// center and the card drawn over the rest is the one it resolves to.
//
// THE SLOT IS NOT THE FIRST ONE. Any suit may be started on any foundation
// (specs/foundations.md), so the pile is built on foundation 1 and a build that
// answers a press over one foundation with another foundation's card fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseFoundation,
  pressPoint,
  type Harness,
} from "../harness";

/** The foundation the pile is built on, named away from the first slot. */
const FOUNDATION = 1;

/** It is built from the Ace up to this rank, so it holds three cards. */
const BUILT_TO = 3;

/** What the press owes the hand: the foundation's top card, and nothing else. */
const EXPECTED_RUN = ["3S"];

/** What the foundation keeps while that card is in hand. */
const EXPECTED_LEFT = ["AS", "2S"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lifts a foundation's top card on a press over that foundation", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", BUILT_TO);

  const at = pressPoint(h.snapshot(), "foundation", FOUNDATION, BUILT_TO - 1);
  h.debug.pointerDown(at.x, at.y);
  const held = h.snapshot();
  await h.advance(1);
  captureStill(h, "held");

  assertDeepEqual(
    held.drag === null ? null : pileSpecs(held.drag.cards),
    EXPECTED_RUN,
    `the run in hand after a press on foundation ${FOUNDATION}: its top card ` +
      "alone, and not the pile beneath it (specs/controls.md)",
  );
  assertDeepEqual(
    held.drag === null
      ? null
      : { fromPile: held.drag.fromPile, fromIndex: held.drag.fromIndex },
    { fromPile: "foundation", fromIndex: FOUNDATION },
    "the pile the run in hand was lifted from (specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileSpecs(held.foundations[FOUNDATION]),
    EXPECTED_LEFT,
    `the cards left on foundation ${FOUNDATION}: the lifted card leaves the ` +
      "pile as it enters the hand (specs/controls.md)",
  );
});
