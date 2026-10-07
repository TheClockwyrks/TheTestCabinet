// Orrery — what the how-to says (specs/ui.md `howto`).
//
// Five pages, in the order specs/ui.md fixes them, told in a player's words
// rather than as rules of a system: the sky, the machine, the tape, running,
// and finishing. Page two names every sigil's engraving in one line apiece,
// which is why it is the long one and is laid out in two columns.
//
// The copy is data, not drawing: `src/screens.ts` lays it out, and a test can
// read it without a canvas.

import { CONSTELLATION_TARGET, HOWTO_PAGES } from "./constants";

/** One page of the how-to. */
export interface HowtoPage {
  /** The page's heading. */
  readonly title: string;
  /** The paragraphs, each already short enough to sit on the stage. */
  readonly lines: readonly string[];
  /** The sigil lines, laid out in two columns beneath the paragraphs. */
  readonly columns?: readonly string[];
}

/**
 * The copy on the how-to's single menu item (specs/ui.md `howto`). The screen
 * carries one item, index `0`, and the words on it are the build's to choose;
 * `confirm`, `back`, and taking the item all do the same thing, so it says so.
 */
export const HOWTO_ITEM_TEXT = "BACK TO TITLE";

/** The five how-to pages, in order. */
export const HOWTO_CONTENT: readonly HowtoPage[] = [
  {
    title: "THE SKY",
    lines: [
      "Ninety-one hexes of night, and the bodies that drift across them.",
      "A mote is one body at rest on one hex. There is inert dust; the four",
      "essences of cloud, ice, fire and stone; quicksilver, which is spent",
      "rather than kept; the six planets, from Saturn up the ladder to Sol;",
      "condensed shadow and light; and aether, which is all four essences at",
      "once.",
      "",
      "A filament is a rigid link between two motes on neighbouring hexes.",
      "Motes joined by filaments are one constellation, and a constellation",
      "travels as one body: carry any mote of it and the whole thing comes.",
      "",
      "A challenge names its reagents — what the field will hand you — and its",
      `products, the constellations you have to make of them. Deliver every`,
      `product ${CONSTELLATION_TARGET} times over and the challenge is yours.`,
    ],
  },
  {
    title: "THE MACHINE",
    lines: [
      "A rise is where a reagent enters the field; a set is where a finished",
      "constellation leaves it. Place every rise and every set before you run.",
      "",
      "An arm stands on one hex and reaches out along a spoke to a gripper. A",
      "biarm carries two grippers, a triarm three, a hexarm all six, and a",
      "piston's reach grows and shrinks while it runs. The zodiac wheel turns",
      "six fixtures on a hub, and a track is a path an arm rides along.",
      "",
      "A sigil is engraved on the field and acts on whatever rests on it:",
    ],
    columns: [
      "bind — joins the two motes on it.",
      "manifold — joins a centre to three.",
      "triune — a heavy link between novas.",
      "sunder — breaks a filament.",
      "wane — an essence falls to dust.",
      "mirror — copies an essence onto dust.",
      "ascend — quicksilver raises a planet.",
      "conjoin — two planets make the next.",
      "eclipse — two dust part into dark and light.",
      "confluence — four essences become aether.",
      "dispersion — aether parts into four again.",
      "void — swallows a loose mote whole.",
    ],
  },
  {
    title: "THE TAPE",
    lines: [
      "Every arm and every wheel carries a tape: a row of instructions it",
      "works through one per cycle, and then starts again from the top.",
      "",
      "All the tapes loop together on one shared period — the length of the",
      "longest tape on the machine — so a short tape simply comes round more",
      "often than a long one, and a blank cell is a cycle spent standing still.",
      "",
      "Click a cell to put the cursor there, then write:",
      "   G grab      V drop        A / D turn the arm about its base",
      "   Z / C pivot what it holds  W / S a piston's reach",
      "   T / B ride a track forward and back",
      "",
      "Delete blanks a cell, Backspace rubs out the one behind the cursor,",
      "R writes the run of instructions that brings the arm home, and Y",
      "repeats everything up to the cursor. The arrow keys move the cursor.",
    ],
  },
  {
    title: "RUNNING",
    lines: [
      "SPACE sets the machine going, and pauses it again. N runs exactly one",
      "cycle and stops. The comma and full stop keys slow it down and speed",
      "it up, from one cycle a second to thirty.",
      "",
      "Motes collide. If two of them come within a mote's width of each other",
      "at any point of a cycle — not only where they land — the machine halts",
      "on the spot.",
      "",
      "A halt freezes everything exactly where it stood. The parts and motes",
      "that caused it are marked on the field, and the banner across the top",
      "says what went wrong. ESC puts you back in the editor with the machine",
      "untouched, ready to be argued with.",
    ],
  },
  {
    title: "FINISHING",
    lines: [
      `Every set on the field has to take its product ${CONSTELLATION_TARGET} times`,
      "over. When the last of them does, the run is finished and scored.",
      "",
      "A finished machine is scored three ways at once:",
      "   cost     what the parts you placed came to",
      "   cycles   how long the machine ran",
      "   area     how much of the field it touched",
      "",
      "Lower is better on all three, and each is kept on its own, so the",
      "cheapest answer, the quickest answer and the tidiest answer can all be",
      "yours at the same time. Come back and beat them.",
    ],
  },
];

/** The page at `index`, clamped to the pages this build ships. */
export function howtoPage(index: number): HowtoPage {
  const at = Math.min(Math.max(0, Math.trunc(index)), HOWTO_PAGES - 1);
  return HOWTO_CONTENT[at];
}
