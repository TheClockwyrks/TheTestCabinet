import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FONT_CELL_HEIGHT,
  FONT_CELL_WIDTH,
  FONT_FIRST_CODE_POINT,
  FONT_LAST_CODE_POINT,
  glyphRows,
} from "./hudFont";

/**
 * The face the player letters HUD text in, and the copy that keeps it the
 * engine's face rather than one of the console's own.
 *
 * `drawHudText` is the one lettering a recording does not carry as pixels: the
 * document holds the string, the position and the size, and what the letters
 * look like is decided by whoever draws them. Both 3D engine packages carry
 * Unscii 16 as glyph data for exactly that reason — "the same call letters the
 * same in every build and in the player" — and this module is the third copy.
 * Nothing but a comparison keeps three copies identical, so here is the
 * comparison.
 */

/** Where the shared half of the file starts: everything above it is a banner. */
const SHARED = "/** The width of a glyph cell, in pixels. */";

/**
 * One of the three copies, read from disk.
 *
 * The path is held in a variable rather than written inline because Vite
 * rewrites a literal `new URL("./x", import.meta.url)` into an asset URL of
 * its own, which `readFileSync` will not take.
 */
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** The shared half of one of the three copies. */
function shared(path: string): string {
  const source = read(path);
  const at = source.indexOf(SHARED);
  expect(at, `${path} carries the shared declarations`).toBeGreaterThan(0);
  return source.slice(at);
}

describe("the console's copy of the engines' face", () => {
  it("is the same data both engines carry, byte for byte", () => {
    const ours = shared("./hudFont.ts");
    expect(ours).toBe(shared("../../../../../../simple-3d/src/font.ts"));
    expect(ours).toBe(shared("../../../../../../structured-3d/src/font.ts"));
  });

  it("is a copy rather than an import, so a vendored engine is not a dependency", () => {
    expect(read("./hudFont.ts")).not.toMatch(/^import /m);
  });
});

describe("the glyphs the face letters", () => {
  it("is an 8×16 cell over printable ASCII", () => {
    expect([FONT_CELL_WIDTH, FONT_CELL_HEIGHT]).toEqual([8, 16]);
    expect([FONT_FIRST_CODE_POINT, FONT_LAST_CODE_POINT]).toEqual([0x20, 0x7e]);
  });

  it("answers sixteen row bytes for every covered code point", () => {
    for (
      let code = FONT_FIRST_CODE_POINT;
      code <= FONT_LAST_CODE_POINT;
      code += 1
    ) {
      const rows = glyphRows(code);
      expect(rows).toHaveLength(FONT_CELL_HEIGHT);
      for (const row of rows) expect(row).toBeLessThanOrEqual(0xff);
    }
  });

  it("letters a space as nothing and a capital A as something", () => {
    expect([...glyphRows(0x20)].every((row) => row === 0)).toBe(true);
    expect([...glyphRows(0x41)].some((row) => row !== 0)).toBe(true);
  });

  it("letters a character outside the coverage as the replacement box", () => {
    const box = [...glyphRows(0x2603)];
    expect(box).toEqual([...glyphRows(0x7f)]);
    expect(box).toEqual([...glyphRows(Number.NaN)]);
    expect(box.some((row) => row !== 0)).toBe(true);
  });

  it("hands back a fresh array, so a caller may scribble on it", () => {
    const rows = glyphRows(0x41);
    rows[0] = 0xff;
    expect(glyphRows(0x41)[0]).not.toBe(0xff);
  });
});
