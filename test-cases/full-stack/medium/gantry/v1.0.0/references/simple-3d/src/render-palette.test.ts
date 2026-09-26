// The look: the one thing about it a test can hold to is that the utilization
// ramp reads monotonically, which `specs/overview.md` requires of it.

import { describe, expect, it } from "vitest";
import { CREAK_THRESHOLD } from "./constants";
import {
  BACKGROUND,
  css,
  display,
  lighten,
  materialColour,
  mono,
  OVER_LIMIT,
  utilizationColour,
} from "./render-palette";

/** How hot a colour reads: its red against the mean of the other two. */
const heat = (colour: number): number => {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return r - (g + b) / 2;
};

describe("the utilization ramp", () => {
  it("climbs monotonically from slack to the limit", () => {
    // The ramp reads in one direction rather than doubling back: its heat rises
    // at every step from slack to a member's limit.
    let previous = heat(utilizationColour(0)) - 1;
    for (let i = 0; i <= 100; i++) {
      const now = heat(utilizationColour(i / 100));
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
  });

  it("clamps below zero to the slack end", () => {
    expect(utilizationColour(-3)).toBe(utilizationColour(0));
  });

  it("leaves the ramp for white hot past the limit", () => {
    expect(utilizationColour(1.0001)).toBe(OVER_LIMIT);
    expect(utilizationColour(Number.NaN)).toBe(OVER_LIMIT);
    expect(heat(OVER_LIMIT)).toBeLessThan(heat(utilizationColour(1)));
  });

  it("passes through its named stops", () => {
    expect(utilizationColour(CREAK_THRESHOLD)).toBe(0xef8b2c);
    expect(utilizationColour(1)).toBe(0xe1362a);
  });
});

describe("the rest of the palette", () => {
  it("tells the three materials apart", () => {
    const colours = ["strut", "cable", "rail"].map(materialColour);
    expect(new Set(colours).size).toBe(3);
  });

  it("lifts a colour toward white and holds the lift inside 0..1", () => {
    expect(lighten(0x000000, 1)).toBe(0xffffff);
    expect(lighten(0x000000, 0)).toBe(0x000000);
    expect(lighten(0x808080, -1)).toBe(0x808080);
  });

  it("writes a colour as CSS, padded to six digits", () => {
    expect(css(0x0a0b0c)).toBe("#0a0b0c");
    expect(BACKGROUND).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("sets type in the two faces the readouts use", () => {
    expect(display(20)).toContain("700 20px");
    expect(mono(12, 400)).toContain("400 12px");
  });
});
