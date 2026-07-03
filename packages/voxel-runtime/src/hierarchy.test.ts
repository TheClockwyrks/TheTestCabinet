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

const pitch = (over: Partial<JointSpec> = {}): JointSpec => ({
  name: "gun_pitch",
  part: "turret",
  kind: "rotation",
  axis: "x",
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

  it("holds an auto joint at rest, and poses it from an overlaid caller value", () => {
    // `auto` joints no longer carry their own clip: they read the caller map (an
    // animation overlays its sampled values there), holding at `rest` when absent.
    const rig: ModelSpec = {
      parts: [part("turret")],
      joints: [yaw({ drive: "auto", min: -Math.PI, max: Math.PI, rest: 0 })],
    };
    // No overlaid value → rest (0) → identity rotation.
    const rest = world(poseRig(rig, {}), "turret");
    expect(rest[0]).toBeCloseTo(1, 6);
    expect(rest[8]).toBeCloseTo(0, 6);
    // An overlaid caller value (0.5 rad about Y) poses the auto joint.
    const m = world(poseRig(rig, { caller: { turret_yaw: 0.5 } }), "turret");
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

  it("pitches a forward-pointing part UP for a positive angle (positive pitch elevates)", () => {
    // Convention: a positive rotation about x lifts a part that points forward
    // (+z) up toward +y — what every rig brief promises by `max = barrel high`.
    // A muzzle voxel out front at (0,0,1), posed through the world matrix, must
    // rise. With the pivot at the origin its transformed y is m[9]·1 = sin(θ).
    const rig: ModelSpec = { parts: [part("turret")], joints: [pitch()] };
    const m = world(poseRig(rig, { caller: { gun_pitch: 0.5 } }), "turret");
    const yOfForwardPoint = m[9]! * 1; // world · (0,0,1) → y component
    expect(yOfForwardPoint).toBeCloseTo(Math.sin(0.5), 6);
    expect(yOfForwardPoint).toBeGreaterThan(0); // up, not down
    // It tips forward-and-up, staying in front (z' = cos θ > 0), not flipping back.
    expect(m[10]).toBeCloseTo(Math.cos(0.5), 6);
    // A negative pitch depresses the same part below the mount.
    const down = world(poseRig(rig, { caller: { gun_pitch: -0.5 } }), "turret");
    expect(down[9]).toBeLessThan(0);
  });

  it("applies a joint's fixed mount offset as a static compound attach", () => {
    // A joint with an empty driven range but a non-zero offset is a purely static
    // mount: it translates the part by the offset regardless of any caller value.
    const rig: ModelSpec = {
      parts: [part("turret")],
      joints: [yaw({ min: 0, max: 0, rest: 0, offset: [3, -1, 2] })],
    };
    const m = world(poseRig(rig, {}), "turret");
    expect([m[12], m[13], m[14]]).toEqual([3, -1, 2]);
  });

  it("composes a joint's fixed mount rotation with its driven motion", () => {
    // The mount pre-rotates 90° about Y; the driven yaw adds another 90°, so the
    // part ends up rotated 180° about Y (offset shifts it afterward).
    const rig: ModelSpec = {
      parts: [part("turret")],
      joints: [
        yaw({
          min: -Math.PI,
          max: Math.PI,
          orient: [0, Math.PI / 2, 0],
          offset: [1, 0, 0],
        }),
      ],
    };
    const m = world(poseRig(rig, { caller: { turret_yaw: Math.PI / 2 } }), "turret");
    // R_y(180°): m[0] = cos(π) = -1, m[10] = -1; plus the mount offset on x.
    expect(m[0]).toBeCloseTo(-1, 6);
    expect(m[10]).toBeCloseTo(-1, 6);
    expect(m[12]).toBeCloseTo(1, 6);
  });
});
