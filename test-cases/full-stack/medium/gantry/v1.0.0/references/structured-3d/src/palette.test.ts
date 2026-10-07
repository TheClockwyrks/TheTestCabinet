import { describe, expect, it } from "vitest";
import { CREAK_THRESHOLD } from "./constants";
import {
  css,
  display,
  lighten,
  materialColour,
  mono,
  OVER_LIMIT,
  utilizationColour,
} from "./palette";

/** The ramp's heat: what `specs/overview.md` asks to climb monotonically. */
const heat = (colour: number): number => {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return r - (g + b) / 2;
};

describe("utilizationColour", () => {
  it("climbs monotonically from slack to the limit", () => {
    let previous = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const now = heat(utilizationColour(i / 100));
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
  });

  it("clamps below zero and leaves the ramp past the limit", () => {
    expect(utilizationColour(-4)).toBe(utilizationColour(0));
    expect(utilizationColour(1.0001)).toBe(OVER_LIMIT);
    expect(utilizationColour(Number.NaN)).toBe(OVER_LIMIT);
  });

  it("is hotter at the creak threshold than below it", () => {
    expect(heat(utilizationColour(CREAK_THRESHOLD))).toBeGreaterThan(
      heat(utilizationColour(CREAK_THRESHOLD - 0.2)),
    );
  });
});

describe("the palette's small helpers", () => {
  it("writes a colour as CSS, padded to six digits", () => {
    expect(css(0x00ff00)).toBe("#00ff00");
    expect(css(0x000001)).toBe("#000001");
  });

  it("lifts a colour toward white and clamps the amount", () => {
    expect(lighten(0x000000, 1)).toBe(0xffffff);
    expect(lighten(0x000000, 4)).toBe(0xffffff);
    expect(lighten(0x808080, -1)).toBe(0x808080);
  });

  it("tells the three materials apart", () => {
    const struts = materialColour("strut");
    expect(materialColour("cable")).not.toBe(struts);
    expect(materialColour("rail")).not.toBe(struts);
    expect(materialColour("unknown")).toBe(struts);
  });

  it("sets a font in the face it names", () => {
    expect(mono(14)).toContain("14px");
    expect(mono(14, 700)).toContain("700");
    expect(display(20)).not.toBe(mono(20));
  });
});
