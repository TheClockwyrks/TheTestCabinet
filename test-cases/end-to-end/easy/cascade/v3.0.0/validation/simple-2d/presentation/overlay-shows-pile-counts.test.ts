// presentation/overlay-shows-pile-counts — the overlay reports the pile sizes.
//
// THE RULE. specs/instrumentation.md, "Diagnostics", lists among the sources the
// build registers: "how many cards are in the stock, on the waste, and on each of
// the four foundations" and "how many cards are in each of the seven columns".
// Under this engine "Registering those values is the whole of Cascade's part,
// through `InitApi.diagnostics`", so what this point decides is that the build
// registered those thirteen counts.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The pile counts. The screen and the
// mode are `presentation/overlay-shows-screen`, the drag
// `presentation/overlay-shows-drag`, and the cascade
// `presentation/overlay-shows-cascade`. That watching the panel costs the game
// nothing is the engine's under this engine and is graded on `none` alone.
//
// THE BOARD IS POSED SO EVERY COUNT IS OWED. The thirteen piles are given
// `11`, `5`, `1 2 3 4` and `1 2 3 4 5 5 6` cards, one full deck between them, and
// the reading is a MULTISET: a figure two piles share must appear on the panel
// twice, so a build reporting one of the two has not reported the other. A build
// that prints a single total instead of the seven columns carries neither of the
// column fives and fails, and one that leaves the foundations out carries one `1`
// where two are owed and fails.
//
// THE VALUE IS READ, NEVER THE NAME, and never as a substring: a count is matched
// as a whole run of digits, so the `1` owed by a pile is not answered by the `1`
// inside the stock's `11`. How a build lays the thirteen out — one line each, one
// line per group, an array — makes no difference to that reading, which is what
// specs/instrumentation.md leaves it free to choose.
//
// THE WORLD IT POSES. Exactly the fifty-two cards above, on an empty table in
// play, and nothing else: no drag, no flyers, so the only figures on the panel
// besides the thirteen counts are the zeros of the sources that read them.

import { afterEach, beforeEach, it } from "vitest";
import { FOUNDATION_COUNT, TABLEAU_COLUMNS } from "../constants";
import {
  RANK_LABELS,
  SUIT_LETTERS,
  captureStill,
  createHarness,
  drawFrame,
  openTable,
  posePile,
  poseWaste,
  toggleOverlay,
  type Harness,
  type Suit,
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

/** One full deck, in the order specs/deal.md builds it, as card specs. */
function deck(): string[] {
  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  return suits.flatMap((suit) =>
    RANK_LABELS.map((rank) => `${rank}${SUIT_LETTERS[suit]}`),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every pile's card count on the overlay", async () => {
  openTable(h);

  const cards = deck();
  let dealt = 0;
  const take = (count: number, faceDown = false): string[] =>
    cards
      .slice(dealt, (dealt += count))
      .map((spec) => (faceDown ? `#${spec}` : spec));

  posePile(h, "stock", 0, take(STOCK, true));
  poseWaste(h, take(WASTE), WASTE_SETS);
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    posePile(h, "foundation", i, take(FOUNDATIONS[i]));
  }
  for (let i = 0; i < TABLEAU_COLUMNS; i += 1) {
    posePile(h, "tableau", i, take(COLUMNS[i]));
  }

  const before = await drawFrame(h);
  const after = await toggleOverlay(h);
  captureStill(h, "overlay");
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
        `(specs/instrumentation.md: how many cards are in the stock, on the ` +
        "waste, on each of the four foundations, and in each of the seven " +
        "columns)",
      times,
    );
  }
});
