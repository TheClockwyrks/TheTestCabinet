// handling/press-grabs-foundation-top — a press on a foundation lifts its top
// card, and that card alone.
//
// `specs/controls.md` fixes it: "A foundation's top card" is lifted as "That card
// alone". `specs/foundations.md` states why the card may leave at all: "A
// foundation's top card may be moved back onto a tableau column that accepts it
// ... The card leaves the foundation, and the card beneath it becomes that
// foundation's top card."
//
// WHAT THE POSE DISTINGUISHES. The foundation is built up to a rank well above
// the Ace, so it holds five cards squared at one anchor and the top card is a
// choice rather than a tautology. A build that hands over the whole pile holds
// five, a build that reaches for the bottom card holds the Ace, and a build that
// refuses a foundation as a source holds nothing. Only "that card alone" reads
// as the single card named here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  cardCenter,
  captureStill,
  createHarness,
  openTable,
  pileTopLeft,
  poseFoundation,
  type Harness,
} from "../harness";

/** The foundation the scenario poses, and how far up it stands. */
const FOUNDATION = 2;
const SUIT = "spades" as const;
const UP_TO = 5;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lifts the foundation's top card and nothing else", async () => {
  await openTable(h);
  const ids = await poseFoundation(h, FOUNDATION, SUIT, UP_TO);

  const anchor = pileTopLeft("foundation", FOUNDATION);
  const press = cardCenter(anchor.x, anchor.y);
  await h.debug.pointerDown(press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "held");

  const held = (await h.snapshot()).drag;
  assertNotNull(held, "the card in hand on the press");
  assertDeepEqual(
    held?.cards.map((c) => c.id),
    [ids[ids.length - 1]],
    "the cards the press lifted off the foundation",
  );
  assertEqual(
    held?.fromPile,
    "foundation",
    "the pile the card was lifted from",
  );
  assertEqual(held?.fromIndex, FOUNDATION, "the foundation it came from");
});
