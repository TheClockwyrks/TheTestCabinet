import { describe, expect, it } from "vitest";
import type { ColorStop } from "./contract";
import {
  colorAt,
  easeFraction,
  hexToLinear,
  opacityAt,
  sampleCurve,
  sampleGradient,
  sizeAt,
} from "./curves";

describe("easeFraction", () => {
  it("pins the endpoints for every interpolation", () => {
    for (const interp of [
      "constant",
      "linear",
      "bezier",
      "ease-in",
      "ease-out",
      "ease-in-out",
    ] as const) {
      expect(easeFraction(interp, 0)).toBeCloseTo(0, 5);
      expect(easeFraction(interp, 1)).toBeCloseTo(1, 5);
    }
  });

  it("steps for constant and is the identity for linear", () => {
    expect(easeFraction("constant", 0.5)).toBe(0);
    expect(easeFraction("constant", 1)).toBe(1);
    expect(easeFraction("linear", 0.25)).toBeCloseTo(0.25, 6);
  });

  it("ease-in stays below linear, ease-out above (slow start vs fast start)", () => {
    expect(easeFraction("ease-in", 0.5)).toBeLessThan(0.5);
    expect(easeFraction("ease-out", 0.5)).toBeGreaterThan(0.5);
  });

  it("clamps inputs outside [0, 1]", () => {
    expect(easeFraction("linear", -1)).toBe(0);
    expect(easeFraction("linear", 2)).toBe(1);
  });
});

describe("sampleCurve", () => {
  it("interpolates from → to", () => {
    const curve = { interp: "linear", from: 2, to: 6 } as const;
    expect(sampleCurve(curve, 0)).toBeCloseTo(2, 6);
    expect(sampleCurve(curve, 0.5)).toBeCloseTo(4, 6);
    expect(sampleCurve(curve, 1)).toBeCloseTo(6, 6);
  });

  it("defaults size to 1 and opacity to 1 when no curve is set, and clamps opacity", () => {
    expect(sizeAt(undefined, 0.4)).toBe(1);
    expect(opacityAt(undefined, 0.4)).toBe(1);
    expect(opacityAt({ interp: "linear", from: 2, to: 2 }, 0.5)).toBe(1);
    expect(opacityAt({ interp: "linear", from: -1, to: -1 }, 0.5)).toBe(0);
  });
});

describe("hexToLinear", () => {
  it("decodes #rrggbb into 0..1 channels", () => {
    expect(hexToLinear("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToLinear("#000000")).toEqual([0, 0, 0]);
    const [r, g, b] = hexToLinear("#ff8000");
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(128 / 255, 6);
    expect(b).toBeCloseTo(0, 6);
  });

  it("falls back to white on a malformed hex", () => {
    expect(hexToLinear("nope")).toEqual([1, 1, 1]);
  });
});

describe("sampleGradient", () => {
  const stops: ColorStop[] = [
    { color: "#000000", at: 0 },
    { color: "#ffffff", at: 1 },
  ];

  it("clamps before the first and after the last stop", () => {
    expect(sampleGradient(stops, -0.5)).toEqual([0, 0, 0]);
    expect(sampleGradient(stops, 1.5)).toEqual([1, 1, 1]);
  });

  it("lerps between bracketing stops", () => {
    const mid = sampleGradient(stops, 0.5);
    expect(mid[0]).toBeCloseTo(0.5, 6);
    expect(mid[1]).toBeCloseTo(0.5, 6);
    expect(mid[2]).toBeCloseTo(0.5, 6);
  });

  it("defaults an empty gradient to white via colorAt", () => {
    expect(colorAt(undefined, 0.5)).toEqual([1, 1, 1]);
    expect(colorAt([], 0.5)).toEqual([1, 1, 1]);
  });
});
