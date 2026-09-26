// The deflector bounce's four steps and the non-deflector reflection pipeline
// of specs/deflector-and-ball.md, checked as pure velocity maps.

import { describe, expect, it } from "vitest";
import { lengthOf, rotateDeg, signedAngleDeg, type Vec } from "./polar";
import {
  orbitalDecay,
  paddleBounce,
  reflectEdge,
  reflectFace,
  surfaceReflect,
} from "./reflect";

const N: Vec = { x: 1, y: 0 };

describe("reflectFace", () => {
  it("reflects the radial component and preserves the tangential", () => {
    const out = reflectFace({ x: -100, y: 40 }, N);
    expect(out.x).toBeCloseTo(100, 12);
    expect(out.y).toBeCloseTo(40, 12);
  });
});

describe("reflectEdge", () => {
  it("reflects the tangential component and preserves the radial", () => {
    const out = reflectEdge({ x: 50, y: -80 }, N);
    expect(out.x).toBeCloseTo(50, 12);
    expect(out.y).toBeCloseTo(80, 12);
  });
});

describe("orbitalDecay", () => {
  it("rotates 6 degrees toward the outward radial when phi exceeds 6", () => {
    const v = rotateDeg(N, 30);
    const out = orbitalDecay(v, N);
    expect(signedAngleDeg(N, out)).toBeCloseTo(24, 9);
  });

  it("rotates the other way for a negative phi", () => {
    const v = rotateDeg(N, -30);
    const out = orbitalDecay(v, N);
    expect(signedAngleDeg(N, out)).toBeCloseTo(-24, 9);
  });

  it("aligns fully when |phi| is under 6", () => {
    const v = rotateDeg(N, 4);
    const out = orbitalDecay(v, N);
    expect(signedAngleDeg(N, out)).toBeCloseTo(0, 9);
  });

  it("decays toward the inward radial when that one is nearer", () => {
    const inward = { x: -1, y: 0 };
    const v = rotateDeg(inward, 10);
    const out = orbitalDecay(v, N);
    expect(signedAngleDeg(inward, out)).toBeCloseTo(4, 9);
  });

  it("preserves speed", () => {
    const v = rotateDeg({ x: 240, y: 0 }, 47);
    expect(lengthOf(orbitalDecay(v, N))).toBeCloseTo(240, 9);
  });
});

describe("paddleBounce", () => {
  it("sends a head-on ball straight back out at the wave speed", () => {
    const out = paddleBounce({ x: -100, y: 0 }, N, 0, 240);
    expect(out.x).toBeCloseTo(240, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });

  it("applies english of 1.2 degrees per degree of offset, sign kept", () => {
    const plus = paddleBounce({ x: -100, y: 0 }, N, 10, 240);
    expect(signedAngleDeg(N, plus)).toBeCloseTo(12, 9);
    const minus = paddleBounce({ x: -100, y: 0 }, N, -10, 240);
    expect(signedAngleDeg(N, minus)).toBeCloseTo(-12, 9);
  });

  it("clamps the outgoing angle to +60 degrees", () => {
    // Specular of this incoming leaves +40 off the radial; +24 english lands
    // at +64, past the clamp.
    const incoming = rotateDeg({ x: -100, y: 0 }, -40);
    expect(signedAngleDeg(N, reflectFace(incoming, N))).toBeCloseTo(40, 9);
    const out = paddleBounce(incoming, N, 20, 240);
    expect(signedAngleDeg(N, out)).toBeCloseTo(60, 9);
  });

  it("clamps the outgoing angle to -60 degrees", () => {
    const incoming = rotateDeg({ x: -100, y: 0 }, 40);
    const out = paddleBounce(incoming, N, -20, 240);
    expect(signedAngleDeg(N, out)).toBeCloseTo(-60, 9);
  });

  it("sets the outgoing speed to the wave speed whatever the arrival", () => {
    const out = paddleBounce({ x: -13, y: 5 }, N, 3, 300);
    expect(lengthOf(out)).toBeCloseTo(300, 9);
  });
});

describe("surfaceReflect", () => {
  it("resolves a face contact as the radial specular plus decay", () => {
    // Incoming 30 degrees off the inward radial reflects to 30 off the
    // outward one, and the decay pulls it to 24.
    const incoming = rotateDeg({ x: -240, y: 0 }, -30);
    const out = surfaceReflect(incoming, "face", N, null);
    expect(signedAngleDeg(N, out)).toBeCloseTo(24, 9);
    expect(lengthOf(out)).toBeCloseTo(240, 9);
  });

  it("resolves an edge contact as the tangential specular plus decay", () => {
    // Mostly tangential motion into the edge: the tangential component
    // reverses and the radial survives.
    const incoming = { x: 60, y: 200 };
    const out = surfaceReflect(incoming, "edge", N, null);
    expect(out.y).toBeLessThan(0);
    expect(out.x).toBeGreaterThan(0);
    expect(lengthOf(out)).toBeCloseTo(lengthOf(incoming), 9);
  });

  it("adds half the ring's surface velocity, then renormalizes", () => {
    const incoming = { x: -240, y: 0 };
    const surface = { x: 0, y: 200 };
    const out = surfaceReflect(incoming, "face", N, surface);
    // The kick tilts the reflected velocity toward the ring's motion...
    expect(out.y).toBeGreaterThan(0);
    // ...and the speed still matches the arrival exactly.
    expect(lengthOf(out)).toBeCloseTo(240, 9);
  });

  it("tilts by the kick before decay: the tilt survives partially", () => {
    const incoming = { x: -240, y: 0 };
    const withKick = surfaceReflect(incoming, "face", N, { x: 0, y: 200 });
    const withoutKick = surfaceReflect(incoming, "face", N, null);
    expect(signedAngleDeg(N, withKick)).toBeGreaterThan(
      signedAngleDeg(N, withoutKick),
    );
  });

  it("preserves the arriving speed on every surface", () => {
    const incoming = rotateDeg({ x: -177, y: 0 }, 17);
    for (const contact of ["face", "edge"] as const) {
      expect(lengthOf(surfaceReflect(incoming, contact, N, null))).toBeCloseTo(
        177,
        9,
      );
    }
  });
});
