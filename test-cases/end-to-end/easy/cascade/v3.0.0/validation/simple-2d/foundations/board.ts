// foundations — the whole board as plain data, for the checks whose requirement is
// a REFUSAL. GROUP-LOCAL.
//
// Seven of this group's items decide that a foundation refuses a card, and
// specs/instrumentation.md fixes what a refusal is: "a refused move leaves the board
// unchanged". specs/tableau.md says the same from the other side — every card a
// refused move carried returns to the pile it was taken from, in the order it
// left, with every face as it was, and the target keeps what it held.
//
// "Unchanged" is not one field, so each of those checks reads the thirteen piles and
// the waste's set memory before the move and again after it, and compares the pair.
// A build that refused the move but dropped the card, turned it over, or reordered
// the pile it came from fails here, and the printed pair says which.
//
// The cards are compared AS SPECS rather than as reported objects, so the comparison
// is over what a card is — its rank, its suit and its face — rather than over the
// ids the build happened to hand out, and a failure prints a board a reader can
// read.

import { pileSpecs, type CascadeSnapshot } from "../harness";

/** The thirteen piles, each bottom card first, and the waste's set memory. */
export interface BoardSpecs {
  stock: string[];
  waste: string[];
  wasteSets: number[];
  foundations: string[][];
  tableau: string[][];
}

/** The board as {@link BoardSpecs}, for a before-and-after comparison. */
export function boardSpecs(snapshot: CascadeSnapshot): BoardSpecs {
  return {
    stock: pileSpecs(snapshot.stock),
    waste: pileSpecs(snapshot.waste),
    wasteSets: [...snapshot.wasteSets],
    foundations: snapshot.foundations.map((cards) => pileSpecs(cards)),
    tableau: snapshot.tableau.map((cards) => pileSpecs(cards)),
  };
}
