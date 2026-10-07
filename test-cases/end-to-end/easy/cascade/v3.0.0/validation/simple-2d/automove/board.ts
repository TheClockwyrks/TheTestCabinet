// automove — the whole board as plain data, for the checks whose requirement is
// that NOTHING moved. GROUP-LOCAL.
//
// Four of this group's items decide a refusal: an auto-move the rules do not allow
// "changes nothing" (specs/instrumentation.md: a pile that holds no playable card
// sends nothing, and a card no foundation accepts is not sent). "Nothing" is not one
// field, so each of those checks reads the thirteen piles and the waste's set memory
// before the call and again after it, and compares the pair.
//
// The cards are compared AS SPECS rather than as reported objects, so the comparison
// is over what a card is (its rank, its suit, and its face) rather than over the ids
// the build happened to hand out, and a failure prints a board a reader can read.

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
