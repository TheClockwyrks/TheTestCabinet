// Cascade — the vocabulary a scenario names cards in. CASE-PROVIDED.
//
// A Klondike check is mostly a sentence about cards: "a red six under a black
// seven", "an Ace on an empty foundation", "a King and the Queen below it".
// Everything here is that sentence written down. Nothing reaches the build,
// nothing asserts, and nothing here is a threshold: these are ARRANGEMENTS, and
// every figure a check holds a build to is stated in that check.
//
// The deck itself is `specs/deal.md`'s: four suits, ranks `1` (Ace) through
// `13` (King), red hearts and diamonds against black spades and clubs. The
// figures come from the build's own seeded `src/constants.ts`, which the case
// supplied and the build does not edit, so nothing below restates a number the
// specification already fixed.
//
// `harness.ts` re-exports all of it, so a validator has one import to write.

import { RANK_MAX, RANK_MIN, SUITS } from "../src/constants";
import type { CardColor, Suit } from "./surface";

/**
 * A card as a scenario names one, before the build has given it an id.
 *
 * `faceUp` is left UNSTATED unless the scenario says which way the card lies,
 * and each pose helper then applies the face its own pile is dealt with: a
 * column, a foundation and the waste take face-up cards, a stock takes
 * face-down ones (specs/deal.md). A scenario that cares says so with
 * {@link down} or {@link up}, and that is honoured everywhere.
 */
export interface CardSpec {
  suit: Suit;
  rank: number;
  faceUp?: boolean;
}

/** One card. Its face is left to the pile it is posed on unless `faceUp` is given. */
export function card(suit: Suit, rank: number, faceUp?: boolean): CardSpec {
  return faceUp === undefined ? { suit, rank } : { suit, rank, faceUp };
}

/** The same card, face-down, wherever it is posed. */
export function down(spec: CardSpec): CardSpec {
  return { suit: spec.suit, rank: spec.rank, faceUp: false };
}

/** The same card, face-up, wherever it is posed. */
export function up(spec: CardSpec): CardSpec {
  return { suit: spec.suit, rank: spec.rank, faceUp: true };
}

/** The four suits in the order a deck is built. */
export const ALL_SUITS: readonly Suit[] = SUITS;

/** The two red suits, and the two black ones (specs/deal.md). */
export const RED_SUITS: readonly Suit[] = ["hearts", "diamonds"];
export const BLACK_SUITS: readonly Suit[] = ["spades", "clubs"];

/** The rank of each named card, so a scenario reads as a sentence. */
export const ACE = RANK_MIN;
export const TWO = 2;
export const THREE = 3;
export const FOUR = 4;
export const FIVE = 5;
export const SIX = 6;
export const SEVEN = 7;
export const EIGHT = 8;
export const NINE = 9;
export const TEN = 10;
export const JACK = 11;
export const QUEEN = 12;
export const KING = RANK_MAX;

/** Every rank, Ace low to King high. */
export const ALL_RANKS: readonly number[] = Array.from(
  { length: RANK_MAX - RANK_MIN + 1 },
  (_, i) => RANK_MIN + i,
);

/** The colour a suit reads as, as `specs/deal.md` fixes it. */
export function colorOf(suit: Suit): CardColor {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** Whether a suit is one of the two red ones. */
export function isRed(suit: Suit): boolean {
  return colorOf(suit) === "red";
}

/** A suit of the opposite colour to `suit`; the first one, so it is stable. */
export function oppositeColorSuit(suit: Suit): Suit {
  return isRed(suit) ? "spades" : "hearts";
}

/** Another suit of the SAME colour as `suit`. */
export function sameColorSuit(suit: Suit): Suit {
  switch (suit) {
    case "hearts":
      return "diamonds";
    case "diamonds":
      return "hearts";
    case "spades":
      return "clubs";
    case "clubs":
      return "spades";
  }
}

/**
 * A descending, colour-alternating run of `length` cards starting at `rank` —
 * the run `specs/tableau.md` defines, written bottom-most first, which is the
 * order {@link poseColumn} takes.
 *
 * `topSuit` is the suit of the FIRST card given, the one highest in the column;
 * each further card takes a suit of the opposite colour, one rank lower. A run
 * that would fall below the Ace is refused here rather than silently truncated,
 * because a scenario that asked for one has miscounted.
 */
export function alternatingRun(
  rank: number,
  length: number,
  topSuit: Suit = "spades",
): CardSpec[] {
  if (rank - length + 1 < RANK_MIN) {
    throw new Error(
      `alternatingRun: ${length} cards from rank ${rank} falls below the Ace`,
    );
  }
  const run: CardSpec[] = [];
  let suit = topSuit;
  for (let i = 0; i < length; i += 1) {
    run.push(card(suit, rank - i));
    suit = oppositeColorSuit(suit);
  }
  return run;
}

/**
 * A whole deck of fifty-two distinct cards, suit by suit and Ace to King —
 * the arrangement a shuffle starts from, and the roster a check that wants
 * "one of each" compares against. Each card's face is left to the pile it is
 * posed on; pass `faceUp` to fix it.
 */
export function fullDeck(faceUp?: boolean): CardSpec[] {
  return ALL_SUITS.flatMap((suit) =>
    ALL_RANKS.map((rank) => card(suit, rank, faceUp)),
  );
}

/** A card's suit and rank as one comparable key, for "one of each" readings. */
export function cardKey(spec: { suit: Suit; rank: number }): string {
  return `${spec.suit}-${spec.rank}`;
}
