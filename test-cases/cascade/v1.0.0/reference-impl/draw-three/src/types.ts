// Cascade — shared types.

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type CardColor = "red" | "black";

// A single playing card. `rank` is 1..13 (Ace low = 1, King high = 13).
export interface Card {
  suit: Suit;
  rank: number;
  faceUp: boolean;
  id: number; // stable identity, useful for debugging / keys
}

// The game's screens (see specs/flow.md).
export type Screen = "title" | "howto" | "playing" | "won";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The two pile kinds a card or run can be picked up from.
export type DragSource = { kind: "waste" } | { kind: "tableau"; col: number };

// Where a dragged card/run may legally land.
export type DropTarget =
  | { kind: "foundation"; index: number }
  | { kind: "tableau"; col: number };

// The four suits and their colors.
export const SUITS: readonly Suit[] = [
  "spades",
  "hearts",
  "diamonds",
  "clubs",
] as const;

export function cardColor(card: Card): CardColor {
  return card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
}

export const RANK_LABEL: readonly string[] = [
  "",
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

export const SUIT_GLYPH: Record<Suit, string> = {
  spades: "♠", // ♠
  hearts: "♥", // ♥
  diamonds: "♦", // ♦
  clubs: "♣", // ♣
};
