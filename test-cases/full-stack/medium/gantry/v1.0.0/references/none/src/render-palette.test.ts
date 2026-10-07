import { describe, expect, it } from "vitest";
import { CREAK_THRESHOLD } from "./constants";
import {
  css,
  materialColour,
  OVER_LIMIT,
  utilizationColour,
} from "./render-palette";

const luma = (colour: number): number => {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The ramp's own monotone quantity: how hot a colour reads. */
const heat = (colour: number): number =>
  ((colour >> 16) & 0xff) - (((colour >> 8) & 0xff) + (colour & 0xff)) / 2;

const distance = (a: number, b: number): number =>
  Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)) +
  Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) +
  Math.abs((a & 0xff) - (b & 0xff));

describe("utilizationColour", () => {
  it("is a colour for every utilization from slack to the limit", () => {
    for (let i = 0; i <= 50; i++) {
      const colour = utilizationColour(i / 50);
      expect(Number.isInteger(colour)).toBe(true);
      expect(colour).toBeGreaterThanOrEqual(0);
      expect(colour).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("moves somewhere new at every step of the ramp", () => {
    let previous = utilizationColour(0);
    for (let i = 1; i <= 20; i++) {
      const colour = utilizationColour(i / 20);
      expect(distance(colour, previous)).toBeGreaterThan(0);
      previous = colour;
    }
  });

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

  it("clamps below slack and reads white hot past the limit", () => {
    expect(utilizationColour(-3)).toBe(utilizationColour(0));
    expect(utilizationColour(1.0001)).toBe(OVER_LIMIT);
    expect(utilizationColour(12)).toBe(OVER_LIMIT);
    expect(utilizationColour(Number.NaN)).toBe(OVER_LIMIT);
  });

  it("stands a member past its limit out from one at breaking point", () => {
    expect(distance(utilizationColour(1), OVER_LIMIT)).toBeGreaterThan(160);
    expect(luma(OVER_LIMIT)).toBeGreaterThan(luma(utilizationColour(1)));
  });

  it("moves plainly across the creak threshold", () => {
    const under = utilizationColour(CREAK_THRESHOLD - 0.2);
    const over = utilizationColour(CREAK_THRESHOLD);
    expect(distance(under, over)).toBeGreaterThan(30);
  });
});

describe("css", () => {
  it("writes a colour as six hex digits", () => {
    expect(css(0x000000)).toBe("#000000");
    expect(css(0x0a1b2c)).toBe("#0a1b2c");
    expect(css(0xffffff)).toBe("#ffffff");
  });
});

describe("materialColour", () => {
  it("gives each material its own resting colour", () => {
    const strut = materialColour("strut");
    const cable = materialColour("cable");
    const rail = materialColour("rail");
    expect(strut).not.toBe(cable);
    expect(strut).not.toBe(rail);
    expect(cable).not.toBe(rail);
  });
});
