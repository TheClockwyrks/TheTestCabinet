import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { describe, expect, it, vi } from "vitest";

// The viewer pulls in three.js and the fiber/drei bindings at module load, none of
// which jsdom can host; stub them so the pure framing helper under test imports
// cleanly. (fieldCenter itself touches only `system.field`.)
vi.mock("@react-three/fiber", () => ({
  Canvas: () => null,
  useFrame: () => {},
}));
vi.mock("@react-three/drei", () => ({ OrbitControls: () => null }));
vi.mock("@test-cabinet/particle-runtime/three", () => ({
  ParticleSystemPlayer: class {},
}));

import { fieldCenter } from "./ParticleViewer";

function system(overrides: Partial<ParticleSystem["field"]>): ParticleSystem {
  return {
    dimensions: 2,
    field: { width: 128, height: 128, ...overrides },
    durationMs: 700,
    fps: 60,
    loop: false,
    emitters: [],
    forces: {},
    subEmitters: [],
  } as ParticleSystem;
}

describe("fieldCenter", () => {
  it("centers a 2D field so a mid-field emitter lands at the origin", () => {
    // Regression guard for the "renders in the top-right, clipped" bug: emitter
    // positions are absolute field coordinates, so an effect authored at the field's
    // middle ([64,64] in a 128×128 field) must offset by -center to sit where the
    // camera and orbit target look — the world origin — not the field's corner.
    const center = fieldCenter(system({ width: 128, height: 128 }));
    expect(center).toEqual([64, 64, 0]);

    const emitter: [number, number, number] = [64, 64, 0];
    const rendered = [
      emitter[0] - center[0],
      emitter[1] - center[1],
      emitter[2] - center[2],
    ];
    expect(rendered).toEqual([0, 0, 0]);
  });

  it("uses half the depth for a 3D field and treats missing depth as zero", () => {
    expect(fieldCenter(system({ width: 80, height: 40, depth: 20 }))).toEqual([
      40, 20, 10,
    ]);
    expect(fieldCenter(system({ width: 100, height: 60 }))).toEqual([
      50, 30, 0,
    ]);
  });
});
