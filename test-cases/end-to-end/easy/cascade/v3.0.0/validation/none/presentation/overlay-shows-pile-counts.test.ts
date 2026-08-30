// presentation/overlay-shows-pile-counts — the overlay reports the pile sizes.
//
// THE RULE. `specs/instrumentation.md`, "Diagnostics", lists among the sources
// the build registers: "how many cards are in the stock, on the waste, and on
// each of the four foundations" and "how many cards are in each of the seven
// columns". Under this engine the panel is the build's own as well, so what this
// point decides is that those thirteen counts reach it.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The pile counts. The screen and the
// mode are `presentation/overlay-shows-screen`, the drag
// `presentation/overlay-shows-drag`, the cascade
// `presentation/overlay-shows-cascade`, and that watching the panel costs the
// game nothing is `presentation/overlay-changes-nothing`.
//
// THE BOARD IS POSED SO EVERY COUNT IS OWED. The thirteen piles are given
// `11`, `5`, `1 2 3 4` and `1 2 3 4 5 5 6` cards, one full deck between them,
// and the reading is a MULTISET: a figure two piles share must appear on the
// panel twice, so a build reporting one of the two has not reported the other. A
// build that prints a single total instead of the seven columns carries neither
// of the column fives and fails, and one that leaves the foundations out carries
// one `1` where two are owed and fails.
//
// THE VALUE IS READ, NEVER THE NAME where a build separated the two, and never
// as a substring: a count is matched as a whole run of digits, so the `1` owed
// by a pile is not answered by the `1` inside the stock's `11`. How a build lays
// the thirteen out — one line each, one line per group, an array — makes no
// difference to that reading, which is what specs/instrumentation.md leaves it
// free to choose.
//
// WHAT THIS READING CANNOT DO. A build's panel may carry lines of its own beside
// the ones the specification asks for, and a figure among them could stand in
// for a count that was never registered; `presentation/overlay.ts` says why
// nothing outside the build can tell the two apart. Thirteen figures owed as a
// multiset is what narrows that as far as this board can: no single stray number
// can cover more than one of them.
//
// THE WORLD IT POSES. Exactly the fifty-two cards above, on an empty table in
// play, and nothing else: no drag, no flyers, so the only figures on the panel
// besides the thirteen counts are the zeros of the sources that read them.

import { afterEach, beforeEach, it } from "vitest";
import {
  FOUNDATION_COUNT,
  RANK_MAX,
  RANK_MIN,
  SUITS,
  TABLEAU_COLUMNS,
} from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseStock,
  poseWaste,
  toggleOverlay,
  type CardSpec,
  type Harness,
} from "../harness";
import { assertFigure, overlayLines } from "./overlay";

/** How many cards the stock is posed with. */
const STOCK = 11;

/** How many cards the waste is posed with, and the sets they were turned in. */
const WASTE = 5;
const WASTE_SETS = [2, 3];

/** How many cards each foundation is posed with, and each column. */
const FOUNDATIONS = [1, 2, 3, 4];
const COLUMNS = [1, 2, 3, 4, 5, 5, 6];

/**
 * The cards the four foundations take: foundation `i` builds `SUITS[i]` up from
 * the Ace, which is the only shape a legal foundation has
 * (`specs/foundations.md`).
 */
function foundationHolds(suit: string, rank: number): boolean {
  const index = SUITS.indexOf(suit as (typeof SUITS)[number]);
  return index >= 0 && rank <= FOUNDATIONS[index];
}

/** The rest of the deck, in suit and rank order: what the other piles are dealt. */
function remainder(): CardSpec[] {
  const specs: CardSpec[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
      if (!foundationHolds(suit, rank)) specs.push({ suit, rank });
    }
  }
  return specs;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws every pile's card count on the overlay", async () => {
  await openTable(h);

  const pool = remainder();
  let dealt = 0;
  const take = (count: number, faceUp = true): CardSpec[] =>
    pool.slice(dealt, (dealt += count)).map((spec) => ({ ...spec, faceUp }));

  await poseStock(h, take(STOCK, false));
  await poseWaste(h, take(WASTE), WASTE_SETS);
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    await poseFoundation(h, i, SUITS[i], FOUNDATIONS[i]);
  }
  for (let i = 0; i < TABLEAU_COLUMNS; i += 1) {
    await poseColumn(h, i, take(COLUMNS[i]));
  }

  const before = await h.frameCalls();
  await toggleOverlay(h);
  const after = await h.frameCalls();
  await captureStill(h, "overlay");
  const lines = overlayLines(before, after);

  // How many of the thirteen piles hold each count, which is how many times the
  // panel owes that figure.
  const owed = new Map<number, number>();
  const owe = (count: number): void => {
    owed.set(count, (owed.get(count) ?? 0) + 1);
  };
  owe(STOCK);
  owe(WASTE);
  for (const count of FOUNDATIONS) owe(count);
  for (const count of COLUMNS) owe(count);

  for (const [count, times] of owed) {
    assertFigure(
      lines,
      count,
      "the size of every pile holding that many cards " +
        "(specs/instrumentation.md: how many cards are in the stock, on the " +
        "waste, on each of the four foundations, and in each of the seven " +
        "columns)",
      times,
    );
  }
});
