// handling/press-grabs-waste-top — a press on the waste lifts its top card, and
// that card alone.
//
// `specs/controls.md` fixes it: "The waste's top card" is lifted as "That card
// alone", and "A card on the waste that is not its top card" lifts "Nothing".
// `specs/stock.md` fixes which card that is: "The waste shows the cards it holds
// from the newest set that still holds any, and the last of those cards is the
// waste's top card", and "Only the waste's top card may be played".
//
// WHAT THE POSE DISTINGUISHES. The waste holds three cards under three sets of
// one, so the newest set shows one card at the waste anchor under either deal
// mode, and two more cards are squared away behind it. A build that hands over
// the whole waste holds three, a build that reaches for the bottom of the pile
// holds the wrong card, and a build that lifts nothing at all holds none. Only
// "that card alone" reads as the one card named here.
//
// THE SETS ARE SIZED SO THE PRESS POINT IS THE SAME UNDER BOTH DEAL MODES. One
// shown card is drawn at the waste anchor whether or not the waste fans
// (`specs/table.md`), so the anchor's own centre is on the top card either way,
// and this common check never has to know a turn count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  cardCenter,
  cards,
  captureStill,
  createHarness,
  openTable,
  pileTopLeft,
  poseWaste,
  type Harness,
} from "../harness";

/** The waste, bottom card first: two squared away behind the one it shows. */
const WASTE = ["2C", "5H", "9S"] as const;

/** One card to each set, so exactly the last card is shown under either mode. */
const WASTE_SETS = [1, 1, 1];

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lifts the waste's top card and nothing else", async () => {
  await openTable(h);
  const ids = await poseWaste(h, cards(...WASTE), WASTE_SETS);

  const anchor = pileTopLeft("waste");
  const press = cardCenter(anchor.x, anchor.y);
  await h.debug.pointerDown(press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "held");

  const held = (await h.snapshot()).drag;
  assertNotNull(held, "the card in hand on the press");
  assertDeepEqual(
    held?.cards.map((c) => c.id),
    [ids[ids.length - 1]],
    "the cards the press lifted off the waste",
  );
  assertEqual(held?.fromPile, "waste", "the pile the card was lifted from");
  assertEqual(held?.fromIndex, 0, "the index the waste is addressed by");
});
