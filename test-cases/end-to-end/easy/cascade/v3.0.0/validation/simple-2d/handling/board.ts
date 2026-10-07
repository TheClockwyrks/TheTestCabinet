// handling — the board AND the hand as plain data, for the checks whose
// requirement is that NOTHING happened. GROUP-LOCAL.
//
// Four of this group's items decide a gesture that must change nothing: a press on
// a face-down card, a press on the bare table, two quick presses on the bare table,
// and a release with nothing held. "Nothing" is not one field, so each of those
// checks reads the whole board before the gesture and again after it and compares
// the pair.
//
// WHY THIS IS NOT `automove/board.ts`. That module reads the thirteen piles alone,
// which is the whole of what an auto-move could have disturbed. A GESTURE can also
// leave a run in the hand or a target reported under it, and a press that lifted a
// card it should not have would leave the piles looking untouched while the card sat
// in the hand. So the reading here carries `drag` and `dropTarget` beside the piles,
// and "unchanged" means the board, the hand, and the reported target together.
//
// The cards are compared AS SPECS rather than as reported objects, so the comparison
// is over what a card is (its rank, its suit, and its face) rather than over the ids
// the build happened to hand out, and a failure prints a board a reader can read.

import {
  pileSpecs,
  type CascadeSnapshot,
  type DropTargetSnapshot,
} from "../harness";

/** The thirteen piles, the waste's set memory, the hand, and the drop target. */
export interface BoardAndHand {
  stock: string[];
  waste: string[];
  wasteSets: number[];
  foundations: string[][];
  tableau: string[][];
  /** The run in hand, bottom card last as it was lifted, or `null` for none. */
  hand: string[] | null;
  dropTarget: DropTargetSnapshot | null;
}

/** The board and the hand as {@link BoardAndHand}, for a before-and-after pair. */
export function boardAndHand(snapshot: CascadeSnapshot): BoardAndHand {
  return {
    stock: pileSpecs(snapshot.stock),
    waste: pileSpecs(snapshot.waste),
    wasteSets: [...snapshot.wasteSets],
    foundations: snapshot.foundations.map((cards) => pileSpecs(cards)),
    tableau: snapshot.tableau.map((cards) => pileSpecs(cards)),
    hand: snapshot.drag === null ? null : pileSpecs(snapshot.drag.cards),
    dropTarget:
      snapshot.dropTarget === null ? null : { ...snapshot.dropTarget },
  };
}
