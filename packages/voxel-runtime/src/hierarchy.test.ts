import { describe, expect, it } from "vitest";
import type { JointSpec, ModelSpec, PartSpec } from "./contract";
import { poseRig } from "./hierarchy";

const part = (name: string, over: Partial<PartSpec> = {}): PartSpec => ({
  name,
  pivot: [0, 0, 0],
  ...over,
});

const yaw = (over: Partial<JointSpec> = {}): JointSpec => ({
  name: "turret_yaw",
  part: "turret",
  kind: "rotation",
  axis: "y",
  pivot: [0, 0, 0],
  min: -1,
  max: 1,
  rest: 0,
  drive: "caller",
  ...over,
});

const world = (posed: ReturnType<typeof poseRig>, name: string): Float32Array =>
  posed.find((p) => p.name === name)!.worldMatrix;

describe("poseRig", () => {
  it("leaves parts where they were sculpted at rest (pivot is not a placement offset)", () => {
    // Parts are authored in the shared volume's world coordinates, so a part's
    // pivot must NOT translate it: at rest every part's world transform is the
    // identity, keeping its voxels exactly where they were sculpted.
    const rig: ModelSpec = {
      parts: [
        part("chassis", { pivot: [10, 0, 0] }),
        part("turret", { parent: "chassis", pivot: [12, 8, 16] }),
      ],
      joints: [],
    };
    const posed = poseRig(rig, {});
    const turret = world(posed, "turret");
    expect([turret[12], turret[13], turret[14]]).toEqual([0, 0, 0]);
    const chassis = world(posed, "chassis");
    expect([chassis[12], chassis[13], chassis[14]]).toEqual([0, 0, 0]);
  });

  it("composes the hierarchy: a child inherits its parent's joint motion", () => {
    // The chassis swings on a joint about x=2; the turret has no joint of its
    // own, so it must ride along with the parent — its world transform equals
    // the parent's, resolved regardless of declaration order.
    const rig: ModelSpec = {
      parts: [
        part("turret", { parent: "chassis" }),
        part("chassis", { pivot: [10, 0, 0] }),
      ],
      joints: [yaw({ part: "chassis", pivot: [2, 0, 0], min: -Math.PI, max: Math.PI })],
    };
    const posed = poseRig(rig, { caller: { turret_yaw: Math.PI } });
    const chassis = world(posed, "chassis");
    const turret = world(posed, "turret");
    // 180° about Y through x=2 maps the origin to x=4, and the child inherits it.
    expect(chassis[12]).toBeCloseTo(4, 6);
    expect([turret[12], turret[13], turret[14]]).toEqual([chassis[12], chassis[13], chassis[14]]);
  });

  it("clamps caller values to [min,max] and falls back to rest", () => {
    const rig: ModelSpec = { parts: [part("turret")], joints: [yaw()] };

    // Beyond max → clamped to 1 rad about Y.
    const clamped = world(poseRig(rig, { caller: { turret_yaw: 5 } }), "turret");
    expect(clamped[0]).toBeCloseTo(Math.cos(1), 6);
    expect(clamped[8]).toBeCloseTo(Math.sin(1), 6);

    // No caller value → rest (0) → identity rotation.
    const rest = world(poseRig(rig, {}), "turret");
    expect(rest[0]).toBeCloseTo(1, 6);
    expect(rest[8]).toBeCloseTo(0, 6);

    // In range → used verbatim.
    const mid = world(poseRig(rig, { caller: { turret_yaw: 0.5 } }), "turret");
    expect(mid[0]).toBeCloseTo(Math.cos(0.5), 6);
  });

  it("samples auto-play joints from their clip at timeMs", () => {
    const rig: ModelSpec = {
      parts: [part("turret")],
      joints: [
        yaw({
          drive: "auto",
          min: -Math.PI,
          max: Math.PI,
          auto: {
            keyframes: [
              { tMs: 0, value: 0 },
              { tMs: 1000, value: 1 },
            ],
            periodMs: 1000,
            looping: true,
          },
        }),
      ],
    };
    // At 500ms the clip value is 0.5 rad about Y.
    const m = world(poseRig(rig, { timeMs: 500 }), "turret");
    expect(m[0]).toBeCloseTo(Math.cos(0.5), 6);
    expect(m[8]).toBeCloseTo(Math.sin(0.5), 6);
  });

  it("rotates a caller joint about its own pivot", () => {
    // A joint pivot offset means the part swings around that point.
    const rig: ModelSpec = {
      parts: [part("turret")],
      joints: [yaw({ pivot: [2, 0, 0], min: -Math.PI, max: Math.PI })],
    };
    // 180° about Y through x=2: a point at the origin maps to x=4.
    const m = world(poseRig(rig, { caller: { turret_yaw: Math.PI } }), "turret");
    expect(m[12]).toBeCloseTo(4, 6);
    expect(m[14]).toBeCloseTo(0, 6);
  });
});
