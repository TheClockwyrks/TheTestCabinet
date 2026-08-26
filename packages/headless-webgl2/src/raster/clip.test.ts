import { describe, expect, it } from "vitest";
import { clipPolygonToNearPlane, clipSegmentToNearPlane, NEAR_EPS, toWindow, type ClipVertex } from "./clip";

/**
 * The geometry step in isolation: near-plane clipping and the viewport
 * transform, asserted on hand-computed clip-space inputs. What a clipped or
 * transformed vertex does to actual pixels is the draw suite's business
 * (`../context.draws.test.ts`); this suite pins the arithmetic those pixels
 * are built from.
 */

/** A clip vertex from plain numbers, with optional varyings. */
function vertex(x: number, y: number, z: number, w: number, varyings: number[] = []): ClipVertex {
  return { position: Float64Array.from([x, y, z, w]), varyings: Float64Array.from(varyings) };
}

describe("clipPolygonToNearPlane", () => {
  it("passes a triangle fully in front of the camera through untouched", () => {
    const triangle = [vertex(0, 0, 0, 1), vertex(1, 0, 0, 1), vertex(0, 1, 0, 2)];
    const clipped = clipPolygonToNearPlane(triangle);
    expect(clipped).toHaveLength(3);
    expect(clipped[0]).toBe(triangle[0]);
    expect(clipped[2]).toBe(triangle[2]);
  });

  it("drops a triangle fully behind the camera", () => {
    expect(clipPolygonToNearPlane([vertex(0, 0, 0, 0), vertex(1, 0, 0, -1), vertex(0, 1, 0, -2)])).toHaveLength(0);
  });

  it("clips one behind vertex into a quad whose crossings sit on the boundary", () => {
    // b is behind (w = -1); the crossings on edges a→b and b→c land at w = ε.
    const clipped = clipPolygonToNearPlane([vertex(0, 0, 0, 1, [0]), vertex(2, 0, 0, -1, [1]), vertex(0, 2, 0, 1, [0.5])]);
    expect(clipped).toHaveLength(4);
    const ws = clipped.map((v) => v.position[3] ?? 0);
    expect(ws.filter((w) => Math.abs(w - NEAR_EPS) < 1e-12)).toHaveLength(2);
  });

  it("clips two behind vertices back to a triangle", () => {
    const clipped = clipPolygonToNearPlane([vertex(0, 0, 0, 1), vertex(2, 0, 0, -1), vertex(0, 2, 0, -1)]);
    expect(clipped).toHaveLength(3);
  });

  it("interpolates varyings linearly in clip space at the crossing", () => {
    // a (w=1, varying 0) → b (w=-1, varying 1): the boundary w=ε sits at
    // t = (1 - ε) / 2 of the way along, so the varying carries that t.
    const clipped = clipPolygonToNearPlane([vertex(0, 0, 0, 1, [0]), vertex(2, 0, 0, -1, [1]), vertex(0, 2, 0, 1, [0])]);
    const crossing = clipped.find((v) => Math.abs((v.position[3] ?? 0) - NEAR_EPS) < 1e-12 && (v.varyings[0] ?? 0) > 0.4);
    expect(crossing).toBeDefined();
    expect(crossing?.varyings[0]).toBeCloseTo((1 - NEAR_EPS) / 2, 9);
  });
});

describe("clipSegmentToNearPlane", () => {
  it("passes a segment fully in front through as the same endpoints", () => {
    const a = vertex(0, 0, 0, 1);
    const b = vertex(1, 1, 0, 2);
    expect(clipSegmentToNearPlane(a, b)).toEqual([a, b]);
  });

  it("drops a segment fully behind", () => {
    expect(clipSegmentToNearPlane(vertex(0, 0, 0, 0), vertex(1, 1, 0, -1))).toBeNull();
  });

  it("moves a behind endpoint to the boundary, keeping endpoint order", () => {
    const clipped = clipSegmentToNearPlane(vertex(0, 0, 0, 1), vertex(2, 0, 0, -1));
    expect(clipped).not.toBeNull();
    expect(clipped?.[0].position[3]).toBe(1);
    expect(clipped?.[1].position[3]).toBeCloseTo(NEAR_EPS, 12);
  });
});

describe("toWindow", () => {
  const viewport: [number, number, number, number] = [0, 0, 8, 8];
  const depthRange: [number, number] = [0, 1];

  it("maps the NDC corners onto the viewport corners", () => {
    const bottomLeft = toWindow(vertex(-1, -1, 0, 1), viewport, depthRange);
    expect([bottomLeft.x, bottomLeft.y]).toEqual([0, 0]);
    const topRight = toWindow(vertex(1, 1, 0, 1), viewport, depthRange);
    expect([topRight.x, topRight.y]).toEqual([8, 8]);
  });

  it("honors a viewport origin and size, per the GL viewport equation", () => {
    const center = toWindow(vertex(0, 0, 0, 1), [2, 4, 4, 2], depthRange);
    expect([center.x, center.y]).toEqual([4, 5]);
  });

  it("divides by w before transforming, and reports 1/w", () => {
    const v = toWindow(vertex(2, 0, 0, 2), viewport, depthRange);
    // clip x 2 at w 2 is NDC 1 — the right viewport edge.
    expect(v.x).toBe(8);
    expect(v.invW).toBe(0.5);
  });

  it("maps NDC z through the depth range", () => {
    expect(toWindow(vertex(0, 0, 0, 1), viewport, depthRange).z).toBe(0.5);
    expect(toWindow(vertex(0, 0, -1, 1), viewport, depthRange).z).toBe(0);
    expect(toWindow(vertex(0, 0, 1, 1), viewport, [0.25, 0.75]).z).toBe(0.75);
  });

  it("pre-multiplies varyings by 1/w for perspective-correct interpolation", () => {
    const v = toWindow(vertex(0, 0, 0, 2, [4, 6]), viewport, depthRange);
    expect(Array.from(v.vow)).toEqual([2, 3]);
  });
});
