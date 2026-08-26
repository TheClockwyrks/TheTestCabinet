import { describe, expect, it } from "vitest";
import {
  HUD_TEXT_DEFAULTS,
  colorAlpha,
  colorHex,
  fitSurface,
  layoutHudText,
  parseColor3d,
} from "./sceneDrawer3d";

/**
 * The drawing arithmetic that belongs to neither the reading of a recording nor
 * the renderer: how a colour is read, where the picture sits inside the surface
 * it was recorded into, and where each glyph of a HUD string goes.
 *
 * All three are copies of engine arithmetic rather than the console's own
 * inventions, so the tests are written against what the ENGINE answers. A
 * player that read a colour more generously, fitted the letterbox differently
 * or advanced its glyphs by a different width would draw a picture that is
 * close to the build's and is not it — the one outcome the whole player is
 * written to refuse.
 */

describe("reading a colour the way the engines read one", () => {
  it("reads the hex forms, alpha included", () => {
    expect(parseColor3d("#f00")).toEqual([1, 0, 0, 1]);
    expect(parseColor3d("#ff0000")).toEqual([1, 0, 0, 1]);
    expect(colorAlpha("#ff000080")).toBeCloseTo(128 / 255, 5);
    expect(colorAlpha("#f008")).toBeCloseTo(136 / 255, 5);
  });

  it("reads the functional forms", () => {
    expect(parseColor3d("rgb(255, 0, 0)")).toEqual([1, 0, 0, 1]);
    expect(colorAlpha("rgba(0, 0, 0, 0.25)")).toBe(0.25);
    expect(colorAlpha("hsla(0 100% 50% / 0.5)")).toBe(0.5);
    expect(parseColor3d("hsl(120, 100%, 50%)")).toEqual([0, 1, 0, 1]);
  });

  it("reads the fourteen names the engines carry, and nothing else", () => {
    expect(parseColor3d("black")).toEqual([0, 0, 0, 1]);
    expect(colorAlpha("transparent")).toBe(0);
    // A name outside the engines' own table is opaque white in the build, so
    // it is opaque white here: a player with a browser's colour vocabulary
    // would draw this one purple and report the frame as clean.
    expect(parseColor3d("rebeccapurple")).toEqual([1, 1, 1, 1]);
    expect(parseColor3d("#12345")).toEqual([1, 1, 1, 1]);
  });

  it("hands a renderer the hex a colour comes to", () => {
    expect(colorHex("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(colorHex("rebeccapurple")).toBe("#ffffff");
  });
});

describe("the letterbox a frame was drawn under", () => {
  it("fits the design field into a wider surface, centred", () => {
    const fit = fitSurface(
      { width: 800, height: 600 },
      { width: 1000, height: 600 },
    );
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(100);
    expect(fit.offsetY).toBe(0);
  });

  it("scales up to a surface bigger on both axes", () => {
    const fit = fitSurface(
      { width: 800, height: 600 },
      { width: 1600, height: 1200 },
    );
    expect(fit).toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
  });

  it("letterboxes on the other axis when the surface is tall", () => {
    const fit = fitSurface(
      { width: 800, height: 600 },
      { width: 800, height: 1000 },
    );
    expect(fit).toEqual({ scale: 1, offsetX: 0, offsetY: 200 });
  });

  it("draws nothing for a degenerate surface", () => {
    expect(
      fitSurface({ width: 800, height: 600 }, { width: 0, height: 0 }).scale,
    ).toBe(0);
    expect(
      fitSurface({ width: 0, height: 0 }, { width: 800, height: 600 }).scale,
    ).toBe(0);
  });
});

describe("laying out a HUD string", () => {
  it("advances each glyph by half the em size, from the top of the em box", () => {
    const glyphs = layoutHudText("ab", { x: 10, y: 20 }, HUD_TEXT_DEFAULTS);
    expect(
      glyphs.map((glyph) => [glyph.x, glyph.y, glyph.width, glyph.height]),
    ).toEqual([
      [10, 20, 12, 24],
      [22, 20, 12, 24],
    ]);
  });

  it("anchors the run at its centre and its right edge", () => {
    const options = { ...HUD_TEXT_DEFAULTS, size: 10 };
    expect(
      layoutHudText(
        "abcd",
        { x: 100, y: 0 },
        { ...options, align: "center" },
      )[0]?.x,
    ).toBe(90);
    expect(
      layoutHudText("abcd", { x: 100, y: 0 }, { ...options, align: "right" })[0]
        ?.x,
    ).toBe(80);
  });

  it("advances by code point, not by UTF-16 unit", () => {
    // An astral character is one cell wide — and letters as the replacement
    // box, which is the coverage rule rather than a layout one.
    expect(
      layoutHudText("\u{1f600}", { x: 0, y: 0 }, HUD_TEXT_DEFAULTS),
    ).toHaveLength(1);
  });

  it("lays out nothing for an empty string or a size that is not a number", () => {
    expect(layoutHudText("", { x: 0, y: 0 }, HUD_TEXT_DEFAULTS)).toEqual([]);
    expect(
      layoutHudText(
        "x",
        { x: 0, y: 0 },
        { ...HUD_TEXT_DEFAULTS, size: Number.NaN },
      ),
    ).toEqual([]);
    expect(
      layoutHudText(
        "x",
        { x: Number.POSITIVE_INFINITY, y: 0 },
        HUD_TEXT_DEFAULTS,
      ),
    ).toEqual([]);
  });

  it("carries the face's own rows, so the player letters what the build lettered", () => {
    const [glyph] = layoutHudText("A", { x: 0, y: 0 }, HUD_TEXT_DEFAULTS);
    expect(glyph?.rows).toHaveLength(16);
    expect([...(glyph?.rows ?? [])].some((row) => row !== 0)).toBe(true);
  });
});
