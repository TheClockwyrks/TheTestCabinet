// automove/starts-a-foundation — an Ace auto-moves onto an empty foundation.
//
// `specs/foundations.md` fixes what an empty foundation takes: "Nothing | An
// Ace, of any suit", and "A card belongs on the foundation that would accept it:
// ... for an Ace, an empty foundation."
//
// WHICH empty foundation is deliberately not asserted. `specs/foundations.md`
// leaves that open — "Any suit may be started on any empty foundation, so the
// suits are not tied to fixed slots" — so pinning a slot here would demand an
// implementation the specification never asked for. What is asserted is the rule
// the specification does fix: the Ace is home, on a foundation that was empty
// and now holds it and nothing else, and no other foundation was disturbed.
// `foundations/any-suit-any-slot` is the item that grades the freedom itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  cards,
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";
import { FOUNDATION_COUNT } from "../constants";

/** The column the Ace is sent from. */
const COLUMN = 4;

/**
 * The Ace offered. Diamonds rather than spades, so a build that only knows how
 * to start a foundation with the suit the deck lists first fails here.
 */
const SENT = "AD";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts an empty foundation with an Ace", async () => {
  await openTable(h);
  const [aceId] = await poseColumn(h, COLUMN, cards(SENT));

  const went = await h.debug.autoMove("tableau", COLUMN);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "home");

  assertEqual(went, true, "the verdict autoMove returned");

  const after = await h.snapshot();
  const at = whereIs(after, aceId);
  assertEqual(at?.pile, "foundation", "the kind of pile the Ace is now on");
  const slot = at?.index ?? -1;
  assertBetween(
    slot,
    0,
    FOUNDATION_COUNT - 1,
    "the foundation slot the Ace started",
  );

  // It STARTED that foundation: the Ace is the only card on it, and it is the
  // only foundation holding anything.
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    assertLength(
      pileOf(after, "foundation", i),
      i === slot ? 1 : 0,
      `the cards on foundation ${i} after the auto-move`,
    );
  }
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    "the cards left in the column",
  );
});
