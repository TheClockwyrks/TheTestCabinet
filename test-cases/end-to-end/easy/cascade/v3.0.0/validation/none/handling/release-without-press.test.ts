// handling/release-without-press — a release with nothing in hand changes
// nothing.
//
// `specs/controls.md` fixes it: "A release with nothing in hand and no control or
// stock under its press changes nothing." A gesture "runs from a press to the
// release that follows it", so a release that follows no press is not the end of
// any gesture and resolves nothing.
//
// WHERE THE RELEASE LANDS, AND WHY THERE. Squarely on the drop rectangle
// (`specs/table.md`) of a column that WOULD accept the card sitting one column
// over — so a build that resolves every release against the board, rather than
// only the release that ends a gesture, moves that card and reads as a different
// board. A build that carries no gesture at all does the same. Only a build that
// requires a press behind the release leaves the table as it was.
//
// Nothing presses at any point in this scenario, which is what the item is about:
// the release is the first pointer event the game sees.
//
// WHAT "UNCHANGED" MEANS HERE. Every one of the thirteen piles, the waste's set
// memory, the screen, and the hand, read before and after and compared entry for
// entry. The pointer itself is left out, because `specs/instrumentation.md` has
// the pointer path record every sample it is given.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  dropRect,
  openTable,
  poseColumn,
  rectCenter,
  type CardView,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The column holding the card a stray release could carry, and which card. */
const SOURCE = 0;
const MOVABLE = "7H";

/** The column the release lands over: a black eight, which accepts a red seven. */
const TARGET = 4;
const TARGET_CARD = "8S";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

/** Every card of every pile, the set memory and the screen. */
function board(snapshot: CascadeSnapshot): unknown {
  const pile = (cards: readonly CardView[]): unknown[] =>
    cards.map((c) => [c.id, c.suit, c.rank, c.faceUp]);
  return {
    screen: snapshot.screen,
    stock: pile(snapshot.stock),
    waste: pile(snapshot.waste),
    wasteSets: [...snapshot.wasteSets],
    foundations: snapshot.foundations.map(pile),
    tableau: snapshot.tableau.map(pile),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing when a release follows no press", async () => {
  await openTable(h);
  await poseColumn(h, SOURCE, [card(MOVABLE)]);
  await poseColumn(h, TARGET, [card(TARGET_CARD)]);

  await h.advance(SETTLE_FRAMES);
  const before = board(await h.snapshot());

  const landing = rectCenter(dropRect("tableau", TARGET, [true]));
  await h.debug.pointerUp(landing.x, landing.y);

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  const after = await h.snapshot();
  assertDeepEqual(
    board(after),
    before,
    "the board after a release with nothing in hand",
  );
  assertNull(after.drag, "the hand after a release that followed no press");
});
