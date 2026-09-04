import { describe, expect, it } from "vitest";
import {
  FONT_CELL_HEIGHT,
  FONT_CELL_WIDTH,
  FONT_FIRST_CODE_POINT,
  FONT_LAST_CODE_POINT,
  glyphRows,
} from "./font";

/**
 * The embedded Unscii 16 data: the table's shape, spot checks of known glyphs
 * against the rows quoted verbatim from the upstream `unscii-16.hex` (the
 * `00041:…` line is the source of the `'A'` expectation below, and so on),
 * and the replacement-box rule for anything outside the coverage. How the
 * rows become an atlas texture or HUD pixels belongs to the rendering suites.
 */

/** The 16 row bytes a hex string from `unscii-16.hex` describes. */
function rowsOf(hex: string): number[] {
  const rows: number[] = [];
  for (let i = 0; i < hex.length; i += 2)
    rows.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return rows;
}

describe("the table's shape", () => {
  it("covers the 95 printable ASCII code points in an 8x16 cell", () => {
    expect(FONT_CELL_WIDTH).toBe(8);
    expect(FONT_CELL_HEIGHT).toBe(16);
    expect(FONT_FIRST_CODE_POINT).toBe(0x20);
    expect(FONT_LAST_CODE_POINT).toBe(0x7e);
    expect(FONT_LAST_CODE_POINT - FONT_FIRST_CODE_POINT + 1).toBe(95);
  });

  it("answers every covered code point with 16 row bytes", () => {
    for (let cp = FONT_FIRST_CODE_POINT; cp <= FONT_LAST_CODE_POINT; cp += 1) {
      const rows = glyphRows(cp);
      expect(rows).toBeInstanceOf(Uint8Array);
      expect(rows).toHaveLength(16);
    }
  });

  it("hands each caller a fresh array, so one caller's scribbles are not another's glyph", () => {
    const first = glyphRows(0x41);
    first[0] = 0xff;
    expect(glyphRows(0x41)[0]).toBe(0x00);
  });
});

describe("known glyphs against the upstream hex", () => {
  it("letters 'A' with the rows unscii-16.hex states", () => {
    // unscii-16.hex: 00041:0000183C6666667E6666666666000000
    expect(Array.from(glyphRows(0x41))).toEqual(
      rowsOf("0000183C6666667E6666666666000000"),
    );
  });

  it("letters '!' with the rows unscii-16.hex states", () => {
    // unscii-16.hex: 00021:00181818181818181800001818000000
    expect(Array.from(glyphRows(0x21))).toEqual(
      rowsOf("00181818181818181800001818000000"),
    );
  });

  it("letters '~' with the rows unscii-16.hex states", () => {
    // unscii-16.hex: 0007E:0072D69C000000000000000000000000
    expect(Array.from(glyphRows(0x7e))).toEqual(
      rowsOf("0072D69C000000000000000000000000"),
    );
  });

  it("letters space as an empty cell", () => {
    expect(Array.from(glyphRows(0x20))).toEqual(new Array<number>(16).fill(0));
  });
});

describe("the replacement box", () => {
  it("stands in for code points on both sides of the coverage", () => {
    const box = Array.from(glyphRows(0x7f));
    expect(Array.from(glyphRows(0x1f))).toEqual(box);
    expect(Array.from(glyphRows(0x2603))).toEqual(box); // a snowman is not ASCII
  });

  it("stands in for a code point that is not a whole number at all", () => {
    const box = Array.from(glyphRows(0x7f));
    expect(Array.from(glyphRows(65.5))).toEqual(box);
    expect(Array.from(glyphRows(Number.NaN))).toEqual(box);
  });

  it("is visibly a box rather than a blank, so missing coverage shows on screen", () => {
    const box = glyphRows(0x7f);
    expect(box.some((row) => row !== 0)).toBe(true);
    expect(Array.from(box)).not.toEqual(Array.from(glyphRows(0x20)));
  });
});
