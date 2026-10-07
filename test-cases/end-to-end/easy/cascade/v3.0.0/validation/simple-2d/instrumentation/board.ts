// instrumentation — a whole board, posed and compared. GROUP-LOCAL.
//
// Nothing outside `validation/simple-2d/instrumentation/` imports it. It is
// scenario arrangement and one comparison, and it holds no threshold and no figure
// the specification fixes; every number a check asserts is stated in the check that
// asserts it.
//
// WHY A WHOLE BOARD. Five of this group's items are about what an operation LEAVES
// ALONE: `addCard` "touches no other pile and no other field, the waste's set memory
// included", `clearPile` "leaves the other twelve piles standing", `clearTable`
// leaves the flyers and the gates, and a refused `move` "leaves the board
// unchanged" (specs/instrumentation.md). "Everything else" cannot be read off an
// empty table, so those checks pose all thirteen piles and a waste that remembers
// two sets, and compare the pair either side of the one call they are about.
//
// THE CARDS ARE COMPARED AS SPECS rather than as reported objects, so a failure
// prints a board a reader can read, and so the comparison is over what a card is
// (its rank, its suit, and its face) rather than over the ids a build happened to
// hand out. Where an item's requirement is the ID, the check reads the id itself.

import { assertDeepEqual } from "../assert";
import {
  pileOf,
  pileSpecs,
  posePile,
  poseWaste,
  type CascadeSnapshot,
  type Harness,
  type PileKind,
} from "../harness";

/** One of the thirteen piles, named by the two scalars every operation names it with. */
export interface PileRef {
  pile: PileKind;
  index: number;
}

/**
 * The board {@link poseFullBoard} lays out: every one of the thirteen piles carrying
 * cards, and no card appearing twice.
 *
 * The arrangement is arbitrary, and deliberately so: no rule runs over a posed
 * board, so what matters is only that each pile is distinguishable from every other
 * and that a card removed from one is missed.
 */
const BOARD: readonly { ref: PileRef; specs: readonly string[] }[] = [
  // The waste comes LAST, because it is the one pile whose pose leaves a field
  // behind it: `addWasteSet` writes the set memory, and specs/instrumentation.md
  // says `addCard` must not touch that field. Posing the waste first would let a
  // build that wipes the memory on every add wipe it before the reading is taken,
  // and the check that is about exactly that fault would pass.
  { ref: { pile: "stock", index: 0 }, specs: ["#2C", "#3C"] },
  { ref: { pile: "foundation", index: 0 }, specs: ["AS", "2S"] },
  { ref: { pile: "foundation", index: 1 }, specs: ["AD", "2D"] },
  { ref: { pile: "foundation", index: 2 }, specs: ["AC"] },
  { ref: { pile: "foundation", index: 3 }, specs: ["AH"] },
  { ref: { pile: "tableau", index: 0 }, specs: ["#7S", "KD"] },
  { ref: { pile: "tableau", index: 1 }, specs: ["#8S", "QC"] },
  { ref: { pile: "tableau", index: 2 }, specs: ["#9S", "JH"] },
  { ref: { pile: "tableau", index: 3 }, specs: ["#10S", "10D"] },
  { ref: { pile: "tableau", index: 4 }, specs: ["#JS", "9C"] },
  { ref: { pile: "tableau", index: 5 }, specs: ["#QS", "8H"] },
  { ref: { pile: "tableau", index: 6 }, specs: ["#KS", "7D"] },
  { ref: { pile: "waste", index: 0 }, specs: ["4H", "5H", "6H"] },
];

/**
 * The sets the posed waste remembers, oldest first.
 *
 * Two of them, summing to the three cards the waste is given, so the memory is
 * consistent with the pile beneath it (specs/stock.md) and a build that emptied it
 * reads as the empty list rather than as a shorter one.
 */
export const WASTE_SETS = [1, 2];

/** Every pile of the board, in the order {@link poseFullBoard} lays them. */
export const EVERY_PILE: readonly PileRef[] = BOARD.map((entry) => entry.ref);

/** A pile written the way a failure message names it: `tableau 3`, `waste`. */
export function pileName(ref: PileRef): string {
  return ref.pile === "stock" || ref.pile === "waste"
    ? ref.pile
    : `${ref.pile} ${ref.index}`;
}

/**
 * Pose all thirteen piles, and the two sets the waste remembers.
 *
 * The caller has already opened the table; this adds the cards. Every card is one
 * `addCard`, so nothing here is a layout operation the build has to implement.
 */
export function poseFullBoard(h: Harness): void {
  for (const entry of BOARD) {
    if (entry.ref.pile === "waste") poseWaste(h, entry.specs, WASTE_SETS);
    else posePile(h, entry.ref.pile, entry.ref.index, entry.specs);
  }
}

/** The cards on one pile, bottom first, as specs. */
export function specsOf(snapshot: CascadeSnapshot, ref: PileRef): string[] {
  return pileSpecs(pileOf(snapshot, ref.pile, ref.index));
}

/**
 * Require every pile but `except` to hold exactly what it held, card for card.
 *
 * One assertion per pile, each naming the pile it is about, so a failure says which
 * of the thirteen the operation reached into rather than printing a board and
 * leaving the reader to find the difference. `except` is the pile the check's own
 * operation was aimed at, or `null` where the operation was meant to touch none.
 */
export function assertOtherPilesUnchanged(
  before: CascadeSnapshot,
  after: CascadeSnapshot,
  except: PileRef | null,
  requirement: string,
): void {
  for (const ref of EVERY_PILE) {
    if (
      except !== null &&
      ref.pile === except.pile &&
      ref.index === except.index
    ) {
      continue;
    }
    assertDeepEqual(
      specsOf(after, ref),
      specsOf(before, ref),
      `${pileName(ref)} holds what it held: ${requirement}`,
    );
  }
}
