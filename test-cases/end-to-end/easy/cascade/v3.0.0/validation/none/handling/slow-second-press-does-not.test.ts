// handling/slow-second-press-does-not — a second press arriving past
// `DOUBLE_CLICK_WINDOW` is not a double click, and sends nothing home.
//
// `specs/controls.md` fixes it: a press is a double click only when "it arrives
// within `DOUBLE_CLICK_WINDOW` (`0.30`) seconds of game time of the previous
// press". A press that is not a double click is a press like any other: it lifts
// what it lands on, and the release that follows it at the same point is a click,
// which "returns any held run to the pile it was lifted from".
//
// WHAT SEPARATES THIS FROM ITS SIBLINGS. Only the window is outside its figure
// here: the two presses land on exactly the same point, so the slop is satisfied,
// and the card under them is playable onto a standing foundation, so the auto-move
// would be legal if the window allowed it. A build with no window at all, or with
// one measured in frames rather than in seconds of game time, sends the card home
// and fails; a build that measures the window as the specification states leaves
// it where it lay. `handling/double-click-auto-moves` is the direction inside the
// window, and `handling/far-second-press-does-not` is the slop.
//
// THE PRESSES ARE `0.4` s OF GAME TIME APART, a third again past the `0.30`
// window. The margin is `0.1` s, twenty-four frames of the clock this suite steps
// in, which no rounding of accumulated delta time could close.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  card,
  cardCenter,
  captureStill,
  clickAt,
  createHarness,
  framesFor,
  openTable,
  pileOf,
  pileTopLeft,
  poseColumn,
  poseFoundation,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation the card would belong on, its suit, and how far it stands. */
const FOUNDATION = 2;
const SUIT = "hearts" as const;
const UP_TO = 5;

/** The column the card sits on, alone and face-up, and which card it is. */
const COLUMN = 3;
const STAYING = "6H";

/**
 * Game time between the two presses, past `DOUBLE_CLICK_WINDOW` (`0.30`).
 *
 * The item's own figure. The `0.1` s margin is a third of the window itself, so a
 * build whose accounting of elapsed time is merely imprecise still reads this as
 * outside it.
 */
const GAP_SECONDS = 0.4;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the card where it lay when the second press is too late", async () => {
  await openTable(h);
  const foundationIds = await poseFoundation(h, FOUNDATION, SUIT, UP_TO);
  const [stayingId] = await poseColumn(h, COLUMN, [card(STAYING)]);

  const at = pileTopLeft("tableau", COLUMN);
  const press = cardCenter(at.x, at.y);

  await clickAt(h, press.x, press.y);
  await h.advance(framesFor(GAP_SECONDS));
  await clickAt(h, press.x, press.y);

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, stayingId),
    { pile: "tableau", index: COLUMN, row: 0 },
    "where the card sits after the second press",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    foundationIds.length,
    "the cards the foundation still holds",
  );
});
