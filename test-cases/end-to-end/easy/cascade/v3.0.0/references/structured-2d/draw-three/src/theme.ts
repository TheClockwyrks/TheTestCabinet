// Cascade — this build's own look.
//
// `specs/overview.md` fixes what a player must READ at a glance — a rank, a
// suit's colour, a back against a face, a card against the felt, an empty slot,
// a lifted run, a highlighted target, and every piece of text — and leaves the
// palette, the type and every other aspect of the look to this build. So none of
// this is a specification figure and none of it belongs beside the ones in
// `src/constants.ts`: it lives here, on its own, where changing the look changes
// one file.
//
// The one colour that leaves this module is `BACKGROUND`, which `src/game.ts`
// re-exports for `src/main.ts` to hand the engine as the colour the canvas is
// cleared to, so the letterbox bars match the felt.
//
// The distances below are the ones the legibility table asks a player to read,
// measured as Euclidean RGB distance out of 441:
//
//   face vs felt   333    back vs face   278    back vs felt    96
//   slot vs felt    64    red vs black   170    label vs plate  higher still
//
// LAYER numbers the picture. The pipeline sorts by layer ascending, so the
// painted trail lies under the piles, the flyers over them, the run in hand over
// those, and the HUD and the screens over everything.

export const COLOR = {
  /** The felt the whole table is played on. */
  felt: "#0e5a34",
  /** The mark an empty pile draws at its anchor. */
  slot: "#1d8f55",
  slotEdge: "#0a4227",

  /** A face-up card's body, and the line around every card. */
  cardFace: "#f7f3ea",
  cardEdge: "#0a2a1a",
  /** A face-down card's back, and the lattice drawn on it. */
  cardBack: "#2b4d8f",
  cardBackInk: "#8fb3ef",

  /** The two suit colours, told apart at a glance. */
  red: "#c02942",
  black: "#1b1b1b",

  /** A legal drop target under the run in hand. */
  highlight: "#ffe066",
  highlightWash: "rgba(255, 224, 102, 0.35)",

  /** The shadow a lifted run casts over the piles it passes. */
  shadow: "rgba(0, 0, 0, 0.35)",

  /** The HUD strip, its control plates and its ink. */
  hudStrip: "#08331f",
  plate: "#0a4227",
  plateEdge: "#1d8f55",
  ink: "#f2f7f3",
  inkDim: "#a8cdb8",
  accent: "#ffe066",
} as const;

/** The stage background, and so the colour of the letterbox bars. */
export const BACKGROUND = COLOR.felt;

/** The order the picture overlaps in. Gaps are left for a layer to slot into. */
export const LAYER = {
  felt: 0,
  trail: 10,
  slots: 20,
  cards: 30,
  flyers: 40,
  hand: 50,
  hud: 60,
  screens: 70,
} as const;

/** The type this build draws with, at the sizes each piece of text is drawn at. */
export const FONT_FAMILY = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export function font(size: number, weight = "bold"): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/** How far a card's corners are rounded. Styling, so it is not a spec figure. */
export const CARD_RADIUS = 9;
