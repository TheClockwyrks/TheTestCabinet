// The look, checked where it carries a requirement.
//
// The specification fixes no palette; it fixes what a player must READ at a
// glance (specs/overview.md). The heat ramp is the one part of the look that is
// therefore testable: the cold end and the near-redline end must read plainly
// apart, and no surge colour may sit anywhere on it.

import { describe, expect, it } from "vitest";
import { BACKGROUND, COLOR, FONT, alpha, heatColor, mix } from "./theme";

/** A `rgb(...)` or `#rrggbb` colour as its three channels. */
function channels(colour: string): [number, number, number] {
  const rgb = colour.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return [
    parseInt(colour.slice(1, 3), 16),
    parseInt(colour.slice(3, 5), 16),
    parseInt(colour.slice(5, 7), 16),
  ];
}

/** How far apart two colours are, as the sum over the three channels. */
function distance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}

describe("mixing", () => {
  it("returns each end at each end", () => {
    expect(channels(mix("#000000", "#ffffff", 0))).toEqual([0, 0, 0]);
    expect(channels(mix("#000000", "#ffffff", 1))).toEqual([255, 255, 255]);
  });

  it("lands halfway at halfway", () => {
    expect(channels(mix("#000000", "#ffffff", 0.5))).toEqual([128, 128, 128]);
  });

  it("clamps a fraction outside the unit interval", () => {
    expect(channels(mix("#000000", "#ffffff", -1))).toEqual([0, 0, 0]);
    expect(channels(mix("#000000", "#ffffff", 2))).toEqual([255, 255, 255]);
  });
});

describe("the heat ramp", () => {
  it("reads plainly apart cold and near the redline", () => {
    expect(distance(heatColor(0), heatColor(95))).toBeGreaterThan(200);
  });

  it("warms monotonically, so hotter never reads cooler", () => {
    let previous = -1;
    for (let heat = 0; heat <= 100; heat += 5) {
      const [red] = channels(heatColor(heat));
      expect(red).toBeGreaterThanOrEqual(previous);
      previous = red;
    }
  });

  it("moves visibly over each tenth of the scale", () => {
    for (let heat = 0; heat < 100; heat += 10) {
      expect(distance(heatColor(heat), heatColor(heat + 10))).toBeGreaterThan(
        20,
      );
    }
  });

  it("clamps outside the scale rather than running off the ramp", () => {
    expect(heatColor(-10)).toBe(heatColor(0));
    expect(heatColor(140)).toBe(heatColor(100));
  });

  it("keeps every surge colour off the ramp", () => {
    for (const surge of [COLOR.ground, COLOR.flyer, COLOR.boss]) {
      for (let heat = 0; heat <= 100; heat += 2) {
        expect(distance(surge, heatColor(heat))).toBeGreaterThan(80);
      }
    }
  });

  it("keeps the three surge kinds apart from each other", () => {
    expect(distance(COLOR.ground, COLOR.flyer)).toBeGreaterThan(120);
    expect(distance(COLOR.ground, COLOR.boss)).toBeGreaterThan(120);
    expect(distance(COLOR.flyer, COLOR.boss)).toBeGreaterThan(120);
  });

  it("keeps a tripped tower's body off the ramp as well", () => {
    for (let heat = 0; heat <= 100; heat += 2) {
      expect(distance(COLOR.tripBody, heatColor(heat))).toBeGreaterThan(80);
    }
  });
});

describe("the rest of the palette", () => {
  it("tells a vent from an exhaust and both from the casing", () => {
    expect(distance(COLOR.vent, COLOR.exhaust)).toBeGreaterThan(150);
    expect(distance(COLOR.vent, COLOR.casing)).toBeGreaterThan(80);
    expect(distance(COLOR.exhaust, COLOR.casing)).toBeGreaterThan(80);
  });

  it("tells a valid footprint from an invalid one", () => {
    expect(distance(COLOR.valid, COLOR.invalid)).toBeGreaterThan(150);
  });

  it("tells the grid from the floor it is drawn on", () => {
    expect(distance(COLOR.grid, COLOR.floor)).toBeGreaterThan(20);
  });

  it("clears the stage and its letterbox bars to one colour", () => {
    expect(COLOR.background).toBe(BACKGROUND);
  });

  it("names a fallback for every face of its type stack", () => {
    expect(FONT).toMatch(/monospace$/);
  });
});

describe("alpha", () => {
  it("carries the colour through at the fraction asked for", () => {
    expect(alpha("#102030", 0.5)).toBe("rgba(16, 32, 48, 0.5)");
  });
});
