// handling/drop-target-by-position — a drop resolves to the pile whose rectangle
// holds the LEADING CARD'S CENTRE, not to the pointer and not to a pile the card
// merely overlaps.
//
// `specs/controls.md` fixes it: "A drop resolves to the pile whose drop rectangle
// contains the center of the run's leading card, that card being the one drawn at
// the top of the held run. The rectangles do not overlap, so that center lies in
// at most one of them."
//
// HOW THE SCENARIO SEPARATES THE THREE MODELS. The press lands near the card's own
// corner, so the pointer and the card's centre are far apart, and the release is
// aimed so that:
//
//   - the leading card's CENTRE lies inside foundation 1's rectangle;
//   - the POINTER lies inside foundation 0's rectangle;
//   - the card's own footprint OVERLAPS foundation 0 without its centre reaching
//     it.
//
// Both foundations are EMPTY and the card carried is an ACE, which
// `specs/foundations.md` says any empty foundation accepts. So all three models
// produce a legal, applied move and read as three different boards: the rule puts
// the Ace on foundation 1, a build resolving by the pointer puts it on foundation
// 0, and a build resolving by overlap puts it on foundation 0 as well. None of
// them is clamped into the right answer by a refusal.
//
// The geometry is checked against the rectangles `specs/table.md` fixes before
// the release, so a failure is the build's resolution rather than this check's
// arithmetic.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertTrue } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  dragRunTo,
  dropRect,
  openTable,
  pileOf,
  pileTopLeft,
  pointInRect,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";
import { CARD_H, CARD_W, TOP_ROW_Y } from "../constants";

/** Where the Ace is lifted from, and which card it is. */
const SOURCE = 0;
const HELD = "AS";

/** The foundation the card's centre is carried into, and the one it overlaps. */
const TARGET = 1;
const NEIGHBOUR = 0;

/** How far the press sits in from the card's own top-left corner. */
const PRESS_INSET = 5;

/**
 * How far inside its own left edge the card's centre is placed.
 *
 * `specs/table.md` puts the foundations at a pitch of `122`, a `100`-wide card
 * and a `22` gap, so a `100`-wide card whose centre sits `8` units inside
 * foundation 1 reaches `42` units back over the gap and `20` units over
 * foundation 0. Small enough that the overlap is unmistakable, and far enough
 * from the edge that no rounding could carry the centre out of the rectangle.
 */
const CENTRE_INSET = 8;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the card on the pile its centre lies in, not the one it overlaps", async () => {
  await openTable(h);
  const [aceId] = await poseColumn(h, SOURCE, [card(HELD)]);

  const targetRect = dropRect("foundation", TARGET);
  const neighbourRect = dropRect("foundation", NEIGHBOUR);
  const landing = {
    x: targetRect.x + CENTRE_INSET,
    y: TOP_ROW_Y + CARD_H / 2,
  };

  // The press is offset from the card's centre, so the pointer trails the card by
  // that much for the whole gesture.
  const from = pileTopLeft("tableau", SOURCE);
  const pressX = from.x + PRESS_INSET;
  const pressY = from.y + PRESS_INSET;
  const pointer = {
    x: landing.x - (CARD_W / 2 - PRESS_INSET),
    y: landing.y - (CARD_H / 2 - PRESS_INSET),
  };

  // The three facts the scenario rests on, held against the rectangles
  // `specs/table.md` fixes.
  assertTrue(
    pointInRect(landing.x, landing.y, targetRect),
    "the leading card's centre inside the target foundation's rectangle",
  );
  assertTrue(
    !pointInRect(landing.x, landing.y, neighbourRect),
    "the leading card's centre outside the neighbouring foundation's rectangle",
  );
  assertTrue(
    pointInRect(pointer.x, pointer.y, neighbourRect),
    "the pointer inside the neighbouring foundation's rectangle",
  );
  assertTrue(
    landing.x - CARD_W / 2 < neighbourRect.x + neighbourRect.w,
    "the card's own footprint overlapping the neighbouring foundation",
  );

  await dragRunTo(h, pressX, pressY, landing.x, landing.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "resolved");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, aceId),
    { pile: "foundation", index: TARGET, row: 0 },
    "the foundation the released card resolved to",
  );
  assertLength(
    pileOf(after, "foundation", NEIGHBOUR),
    0,
    "the neighbouring foundation the card merely overlapped",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    "the cards the source column is left holding",
  );
});
