// Fathom — where the frame put its text. CASE-PROVIDED.
//
// Four points read a run of text as a PLACE rather than as a word: the menu
// reading has to contain the point an item was drawn at, and the HUD's readouts
// have to sit in the strip specs/ui.md gives them. Reading a `fillText` call's
// own arguments cannot answer either, because a build is free to draw under a
// transform — to translate to a HUD corner and draw at the origin, say — so the
// position a call names is only where the text landed once the transform in force
// at that call is applied.
//
// So this module answers one question: for each run of text the frame drew, where
// on the stage did it land, and how wide is it? Its counterpart in `states/` reads
// the same calls for their WORDS, which is a different question and needs none of
// this.
//
// UNDER AN ENGINE THE RECORDER KEEPS THE TRANSFORM PER CALL. `harness.ts` reads
// the real context at the moment of each `fillText`/`strokeText` — the transform
// in force, the measured width of the run under the font in force, and the
// alignment that places the run about its anchor — so the placement is arithmetic
// on what the call itself carried rather than a replay of the frame.
//
// THE RESULT IS IN LOGICAL UNITS at the shape every check in this project builds
// its harness at: the canvas is the stage's own size at a device pixel ratio of
// one, so the engine's viewport transform is the identity and a device pixel is a
// logical unit. A check that builds a harness at some other shape reads the
// picture through `h.device` instead, and none of the points that use this module
// does.

import type { DrawCall } from "./harness";

/** One run of text a frame drew, and where it drew it. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, in logical units. */
  x: number;
  y: number;
  /** The horizontal extent of the glyphs, under the same transform. */
  left: number;
  right: number;
}

/** The 2D context's own default alignment, in force until the build sets one. */
const DEFAULT_TEXT_ALIGN = "start";

/**
 * Every run of text the frame drew, with its anchor placed on the stage.
 *
 * ONE ENTRY PER CALL. A build that letter-spaces a heading draws a glyph per
 * call, which a reader after the COPY has to coalesce; a reader after a PLACE
 * wants each draw's own extent, because a merged run is wider than any of its
 * members and a check holding a readout inside a strip would then be reading a
 * box nothing was drawn in.
 */
export function textDraws(ops: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  for (const op of ops) {
    if (op.kind !== "call") continue;
    if (op.method !== "fillText" && op.method !== "strokeText") continue;
    const [text, ax, ay] = op.args;
    if (typeof text !== "string") continue;
    if (typeof ax !== "number" || typeof ay !== "number") continue;
    const geometry = op.text;
    if (geometry === undefined) continue;
    const { a, b, c, d, e, f } = geometry.transform;
    const x = a * ax + c * ay + e;
    const y = b * ax + d * ay + f;
    // The run's width under the same horizontal scale the anchor took, and the
    // alignment that places it about that anchor.
    const width = geometry.width * Math.hypot(a, b);
    const align = geometry.textAlign || DEFAULT_TEXT_ALIGN;
    const before =
      align === "center"
        ? width / 2
        : align === "right" || align === "end"
          ? width
          : 0;
    draws.push({ text, x, y, left: x - before, right: x - before + width });
  }
  return draws;
}
