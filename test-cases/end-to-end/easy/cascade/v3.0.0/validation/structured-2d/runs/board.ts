// runs — a column written as text, both ways round. GROUP-LOCAL.
//
// Every check in this group is a sentence about one or two columns: "a black 9
// under a red 8, a black 7 and a red 6". Writing that out as objects buries what
// the check is about under punctuation, and reading a failure back as objects
// buries it again. So a card is written the way a deck is read — its rank then
// its suit, `"KS"` for the King of spades and `"10H"` for the ten of hearts, with
// a leading `"#"` for a card lying face-down — and this module turns one into the
// {@link CardSpec} `poseColumn` takes and a reported card back into one.
//
// Reading a column back AS TEXT is what makes the comparisons in this group
// comparisons about cards rather than about ids: a column that came back in a
// different order, short a card, or with a card turned over reads as different
// text, and a failure prints two lines a reviewer can read —
// `["KC", "8S", "7H", "6S"]` beside `["KC", "8S", "6S", "7H"]`. The FACE is
// carried in that text on purpose, because `runs/returns-intact` requires every
// face to come back as it was.
//
// Nothing here asserts and nothing here is a threshold: every figure this group
// holds a build to is stated in the check that holds it. A misspelt card is a
// fault in the check rather than in the build, so it throws a plain error rather
// than failing by assertion — a check that asked for the `"KX"` of nothing has
// decided nothing about the game.

import type { CardSpec, SnapshotCard, Suit } from "../harness";

/** The rank names a deck is read by, Ace low to King high (specs/deal.md). */
const RANK_TEXT: readonly string[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

/** The one letter each suit is written as. */
const SUIT_TEXT: Readonly<Record<Suit, string>> = {
  spades: "S",
  hearts: "H",
  diamonds: "D",
  clubs: "C",
};

/** The suit each letter names. */
const SUIT_OF_LETTER: Readonly<Record<string, Suit>> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};

/**
 * The card a piece of text names, face-up unless it carries a leading `"#"`.
 *
 * The face is always stated, so a column posed from this text lies the way the
 * check wrote it rather than the way a pose helper's default would have it.
 */
export function cardOf(text: string): CardSpec {
  const faceUp = !text.startsWith("#");
  const body = faceUp ? text : text.slice(1);
  const suit = SUIT_OF_LETTER[body.slice(-1).toUpperCase()];
  const rank = RANK_TEXT.indexOf(body.slice(0, -1).toUpperCase());
  if (suit === undefined || rank < 0) {
    throw new Error(
      `runs: "${text}" is not a card; write a rank of ` +
        `${RANK_TEXT.join("/")} and a suit of S/H/D/C, with a leading # for ` +
        "face-down",
    );
  }
  return { suit, rank: rank + 1, faceUp };
}

/** A whole column named as text, bottom card first, as `poseColumn` takes it. */
export function cardsOf(texts: readonly string[]): CardSpec[] {
  return texts.map(cardOf);
}

/**
 * One reported card written out: its rank, its suit, and a leading `#` when it
 * lies face-down. A rank or suit outside the deck is printed as it was reported
 * rather than hidden, because a check comparing two columns wants to SEE that.
 */
export function cardText(card: SnapshotCard): string {
  const face = card.faceUp ? "" : "#";
  const rank = RANK_TEXT[card.rank - 1] ?? String(card.rank);
  const suit = SUIT_TEXT[card.suit] ?? String(card.suit);
  return `${face}${rank}${suit}`;
}

/** A whole pile written out, bottom card first, so the last entry is its top. */
export function pileText(cards: readonly SnapshotCard[]): string[] {
  return cards.map(cardText);
}
