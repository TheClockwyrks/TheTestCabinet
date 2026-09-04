// This build's own look, held to the separations specs/overview.md requires a
// player to read at a glance.
//
// The specification fixes no palette, so nothing here asserts a colour value.
// What it asserts is DISTANCE: every surge type apart from every other, from the
// floor, and from every colour a tower shows anywhere across its heat range,
// tripped included; a tripped tower apart from an online one at the same heat;
// the casing apart from the floor and from the background; and a vent apart
// from an exhaust. Every distance is Euclidean over RGB, whose maximum is about
// 441.

import { describe, expect, it } from "vitest";
import { SURGE_TYPES } from "./constants";
import { COLOR, SURGE_COLOR, TRIPPED_RGB, heatRgb, rgbOf } from "./theme";

type Rgb = readonly [number, number, number];

function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The ramp, sampled finely enough that no gap between samples hides a match. */
const RAMP: Rgb[] = Array.from({ length: 101 }, (_v, heat) => heatRgb(heat));

/** The separation this build holds itself to, well past the 50 a reader needs. */
const APART = 90;

describe("the heat ramp", () => {
  it("reads plainly apart at its cold and hot ends", () => {
    expect(apart(heatRgb(0), heatRgb(99))).toBeGreaterThan(150);
  });

  it("moves at every step of the scale", () => {
    for (let heat = 0; heat < 100; heat += 10) {
      expect(apart(heatRgb(heat), heatRgb(heat + 10))).toBeGreaterThan(10);
    }
  });

  it("reads apart from the floor everywhere along it", () => {
    for (const colour of RAMP) {
      expect(apart(colour, rgbOf(COLOR.floor))).toBeGreaterThan(APART);
    }
  });
});

describe("a tripped tower", () => {
  it("reads apart from an online tower at every heat", () => {
    for (const colour of RAMP) {
      expect(apart(TRIPPED_RGB, colour)).toBeGreaterThan(APART);
    }
  });

  it("reads apart from the floor it stands on", () => {
    expect(apart(TRIPPED_RGB, rgbOf(COLOR.floor))).toBeGreaterThan(APART);
  });
});

describe("the surge", () => {
  it("reads apart from every colour a tower shows", () => {
    for (const type of SURGE_TYPES) {
      const colour = rgbOf(SURGE_COLOR[type]);
      for (const ramp of RAMP) {
        expect(apart(colour, ramp)).toBeGreaterThan(APART);
      }
      expect(apart(colour, TRIPPED_RGB)).toBeGreaterThan(APART);
    }
  });

  it("reads apart from the floor", () => {
    for (const type of SURGE_TYPES) {
      expect(
        apart(rgbOf(SURGE_COLOR[type]), rgbOf(COLOR.floor)),
      ).toBeGreaterThan(APART);
    }
  });

  it("reads apart from every other type", () => {
    for (const a of SURGE_TYPES) {
      for (const b of SURGE_TYPES) {
        if (a === b) continue;
        expect(
          apart(rgbOf(SURGE_COLOR[a]), rgbOf(SURGE_COLOR[b])),
        ).toBeGreaterThan(APART);
      }
    }
  });
});

describe("the casing and its openings", () => {
  it("reads as a wall against the floor and the space outside the stage", () => {
    expect(apart(rgbOf(COLOR.casing), rgbOf(COLOR.floor))).toBeGreaterThan(
      APART,
    );
    expect(apart(rgbOf(COLOR.casing), rgbOf(COLOR.bg))).toBeGreaterThan(APART);
  });

  it("tells a vent from an exhaust and both from the casing", () => {
    expect(apart(rgbOf(COLOR.vent), rgbOf(COLOR.exhaust))).toBeGreaterThan(
      APART,
    );
    expect(apart(rgbOf(COLOR.vent), rgbOf(COLOR.casing))).toBeGreaterThan(
      APART,
    );
    expect(apart(rgbOf(COLOR.exhaust), rgbOf(COLOR.casing))).toBeGreaterThan(
      APART,
    );
  });
});

describe("text", () => {
  it("is legible against the surface it is drawn on", () => {
    expect(apart(rgbOf(COLOR.text), rgbOf(COLOR.panel))).toBeGreaterThan(150);
    expect(apart(rgbOf(COLOR.dim), rgbOf(COLOR.panel))).toBeGreaterThan(100);
    expect(apart(rgbOf(COLOR.text), rgbOf(COLOR.bg))).toBeGreaterThan(150);
  });
});

describe("the build preview", () => {
  it("reads valid plainly apart from invalid", () => {
    expect(apart(rgbOf(COLOR.valid), rgbOf(COLOR.invalid))).toBeGreaterThan(
      APART,
    );
  });
});
