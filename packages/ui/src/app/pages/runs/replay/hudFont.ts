/**
 * The engine's monospace face: Unscii 16, embedded as glyph bitmap data.
 *
 * This is the console's deliberate copy of the face both 3D engines carry —
 * `packages/simple-3d/src/font.ts` and `packages/structured-3d/src/font.ts`,
 * which are byte-identical to each other and, from the first declaration
 * below, to this file. It is a copy for the reason `format3d.ts` is a copy:
 * an engine package is vendored into a run repository and has to stay
 * self-contained, so the console cannot import one, and a console built today
 * has to letter a recording produced by an engine build it has never seen.
 *
 * HUD text is the one lettering a recording does not carry as pixels. A
 * `drawHudText` travels as its string, its position and its size, and what
 * the letters look like is decided by whoever draws them — so the player
 * letters them from the same rows the engine did, and the picture on a
 * reviewer's screen is the picture the build drew rather than whatever face
 * the browser would have picked. (Text the engine rasterized itself — a
 * structured-3d `TextComponent`'s billboard — is captured as a texture and
 * needs none of this.)
 *
 * `hudFont.test.ts` holds this copy against both engines' files byte for
 * byte. Change one copy and you must change the others.
 *
 * Provenance: the face is Unscii 16 by Viznut (Ville-Matias Heikkilä),
 * http://viznut.fi/unscii/ — a bitmap face its author has released into the
 * public domain. The rows below are the printable-ASCII slice (U+0020–U+007E)
 * of `unscii-16.hex`, downloaded 2026-08-25 from
 * http://viznut.fi/unscii/unscii-16.hex (mirrored at
 * https://github.com/viznut/unscii) and transcribed verbatim: each glyph is
 * 32 hex characters, one byte per row, 16 rows of 8 pixels, most significant
 * bit leftmost. The face ships as data rather than as a font file because the
 * docs pin the HUD's lettering to be "a pure function of the call" — no DOM
 * text API, no font loading, the same rows in Node, in a browser, and in the
 * player.
 */

/** The width of a glyph cell, in pixels. */
export const FONT_CELL_WIDTH = 8;

/** The height of a glyph cell, in pixels. */
export const FONT_CELL_HEIGHT = 16;

/** The first code point the face covers: U+0020, space. */
export const FONT_FIRST_CODE_POINT = 0x20;

/** The last code point the face covers: U+007E, tilde. */
export const FONT_LAST_CODE_POINT = 0x7e;

/**
 * The 95 printable-ASCII glyphs, 32 hex characters each, concatenated in code
 * point order. One string rather than 95 so the data costs one constant, and
 * hex rather than base64 so a row in this file can be compared by eye against
 * the `unscii-16.hex` line it was transcribed from.
 */
const GLYPHS =
  "00000000000000000000000000000000" + // U+0020 space
  "00181818181818181800001818000000" + // U+0021 !
  "00666666000000000000000000000000" + // U+0022 "
  "00006C6C6CFE6C6C6CFE6C6C6C000000" + // U+0023 #
  "0018183C666030180C06663C18180000" + // U+0024 $
  "000006C6CCCC181830306666C6C00000" + // U+0025 %
  "0000386C6C38307ADECCCCCC76000000" + // U+0026 &
  "00181818300000000000000000000000" + // U+0027 '
  "000C18183030303030303018180C0000" + // U+0028 (
  "003018180C0C0C0C0C0C0C1818300000" + // U+0029 )
  "0000000066663CFF3C66660000000000" + // U+002A *
  "000000001818187E1818180000000000" + // U+002B +
  "00000000000000000000381818306000" + // U+002C ,
  "000000000000007E0000000000000000" + // U+002D -
  "00000000000000000000181818000000" + // U+002E .
  "030306060C0C181830306060C0C00000" + // U+002F /
  "0000386CC6C6CED6E6C6C66C38000000" + // U+0030 0
  "0000183878181818181818187E000000" + // U+0031 1
  "00003C666606060C183060607E000000" + // U+0032 2
  "00003C666606061C060666663C000000" + // U+0033 3
  "00000C1C3C6CCCCCFE0C0C0C0C000000" + // U+0034 4
  "00007E6060607C06060666663C000000" + // U+0035 5
  "00001C3060607C66666666663C000000" + // U+0036 6
  "00007E0606060C0C1818181818000000" + // U+0037 7
  "00003C666666763C6E6666663C000000" + // U+0038 8
  "00003C666666663E0606060C38000000" + // U+0039 9
  "00000018181800000000181818000000" + // U+003A :
  "00000018181800000000381818306000" + // U+003B ;
  "000000060C18306030180C0600000000" + // U+003C <
  "00000000007E0000007E000000000000" + // U+003D =
  "0000006030180C060C18306000000000" + // U+003E >
  "003C6666060C18181800001818000000" + // U+003F ?
  "00007CC6C6C6DEDEDEDCC0C07C000000" + // U+0040 @
  "0000183C6666667E6666666666000000" + // U+0041 A
  "00007C6666666C786C6666667C000000" + // U+0042 B
  "00003C6666606060606066663C000000" + // U+0043 C
  "0000786C666666666666666C78000000" + // U+0044 D
  "00007E606060607C606060607E000000" + // U+0045 E
  "00007E6060607C606060606060000000" + // U+0046 F
  "00003C666660606E666666663E000000" + // U+0047 G
  "000066666666667E6666666666000000" + // U+0048 H
  "00007E1818181818181818187E000000" + // U+0049 I
  "0000060606060606060666663C000000" + // U+004A J
  "0000C6C6CCCCD8F0D8CCCCC6C6000000" + // U+004B K
  "0000606060606060606060607E000000" + // U+004C L
  "0000C6EEEEFED6D6C6C6C6C6C6000000" + // U+004D M
  "0000C6C6E6E6F6FEDECECEC6C6000000" + // U+004E N
  "00003C6666666666666666663C000000" + // U+004F O
  "00007C666666667C6060606060000000" + // U+0050 P
  "00003C6666666666666666663C0C0600" + // U+0051 Q
  "00007C666666667C6C66666666000000" + // U+0052 R
  "00003C66666030180C0666663C000000" + // U+0053 S
  "00007E18181818181818181818000000" + // U+0054 T
  "0000666666666666666666663C000000" + // U+0055 U
  "0000666666666666663C3C1818000000" + // U+0056 V
  "0000C6C6C6C6C6D6D6FEEEEEC6000000" + // U+0057 W
  "0000C3C3663C1818183C66C3C3000000" + // U+0058 X
  "0000C3C366663C181818181818000000" + // U+0059 Y
  "00007E06060C0C18303060607E000000" + // U+005A Z
  "003C30303030303030303030303C0000" + // U+005B [
  "C0C06060303018180C0C060603030000" + // U+005C \
  "003C0C0C0C0C0C0C0C0C0C0C0C3C0000" + // U+005D ]
  "0010386C6CC6C6000000000000000000" + // U+005E ^
  "000000000000000000000000000000FF" + // U+005F _
  "0018180C060000000000000000000000" + // U+0060 `
  "0000000000003C063E6666663E000000" + // U+0061 a
  "0000606060607C66666666667C000000" + // U+0062 b
  "0000000000003C66606060663C000000" + // U+0063 c
  "0000060606063E66666666663E000000" + // U+0064 d
  "0000000000003C66667E60603C000000" + // U+0065 e
  "00001E3030307E303030303030000000" + // U+0066 f
  "0000000000003E66666666663E06067C" + // U+0067 g
  "0000606060607C666666666666000000" + // U+0068 h
  "0000181800007818181818181E000000" + // U+0069 i
  "00000C0C00000C0C0C0C0C0C0C0C0C78" + // U+006A j
  "00006060606066666C786C6666000000" + // U+006B k
  "0000781818181818181818181E000000" + // U+006C l
  "000000000000CCFED6D6D6D6C6000000" + // U+006D m
  "0000000000007C666666666666000000" + // U+006E n
  "0000000000003C66666666663C000000" + // U+006F o
  "0000000000007C66666666667C606060" + // U+0070 p
  "0000000000003E66666666663E060606" + // U+0071 q
  "0000000000007C666660606060000000" + // U+0072 r
  "0000000000003E60603C06067C000000" + // U+0073 s
  "0000003030307E30303030301E000000" + // U+0074 t
  "0000000000006666666666663E000000" + // U+0075 u
  "00000000000066666666663C18000000" + // U+0076 v
  "000000000000C6C6D6D6D67C6C000000" + // U+0077 w
  "000000000000C6C66C386CC6C6000000" + // U+0078 x
  "0000000000006666666666663E06063C" + // U+0079 y
  "0000000000007E060C1830607E000000" + // U+007A z
  "000E1818181818F018181818180E0000" + // U+007B {
  "18181818181818181818181818180000" + // U+007C |
  "00E030303030301E3030303030E00000" + // U+007D }
  "0072D69C000000000000000000000000"; // U+007E ~

/**
 * The replacement box a character outside the coverage letters as: an empty
 * rectangle filling most of the cell. Synthesized here rather than taken from
 * the face — Unscii's own replacement glyphs sit outside the ASCII slice this
 * module carries, and the docs only ask for "the replacement box".
 */
const REPLACEMENT_BOX = "00007EFEC6C6C6C6C6C6C6FE7E000000";

/**
 * The 16 row bytes of `codePoint`'s glyph, top to bottom, most significant
 * bit leftmost. A code point outside U+0020–U+007E — a fractional or
 * non-finite number included — letters as the replacement box. The returned
 * array is fresh on every call, so a caller may scribble on it.
 */
export function glyphRows(codePoint: number): Uint8Array {
  const covered =
    Number.isInteger(codePoint) &&
    codePoint >= FONT_FIRST_CODE_POINT &&
    codePoint <= FONT_LAST_CODE_POINT;
  const source = covered
    ? GLYPHS.slice(
        (codePoint - FONT_FIRST_CODE_POINT) * 2 * FONT_CELL_HEIGHT,
        (codePoint - FONT_FIRST_CODE_POINT + 1) * 2 * FONT_CELL_HEIGHT,
      )
    : REPLACEMENT_BOX;

  const rows = new Uint8Array(FONT_CELL_HEIGHT);
  for (let row = 0; row < FONT_CELL_HEIGHT; row += 1) {
    rows[row] = Number.parseInt(source.slice(row * 2, row * 2 + 2), 16);
  }
  return rows;
}
