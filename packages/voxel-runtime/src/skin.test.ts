import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JointSpec, ModelSpec, PartSpec, SkinnedMesh } from "./contract";
import { parseSkinnedGlb } from "./glb";
import { identity, rotation, translation } from "./hierarchy";
import { skinMesh, skinningMatrices } from "./skin";

function readGlb(name: string): ArrayBuffer {
  const buf = readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// A rig whose parts ARE the fixture's bones (pelvis root + spine child), with a
// single joint bending the spine about x through its head at y=1.
const part = (name: string, over: Partial<PartSpec> = {}): PartSpec => ({
  name,
  pivot: [0, 0, 0],
  ...over,
});
const bend = (over: Partial<JointSpec> = {}): JointSpec => ({
  name: "spine_bend",
  part: "spine",
  kind: "rotation",
  axis: "x",
  pivot: [0, 1, 0],
  min: -2,
  max: 2,
  rest: 0,
  drive: "caller",
  ...over,
});
const barRig: ModelSpec = {
  parts: [part("pelvis"), part("spine", { parent: "pelvis", pivot: [0, 1, 0] })],
  joints: [bend()],
};

describe("skinMesh", () => {
  it("blends bone matrices by per-vertex weights (a fully-weighted vertex rides its bone)", () => {
    // Two bones: bone0 identity, bone1 translates +10 on x. A vertex fully weighted
    // to bone1 moves the full +10; a 0.5/0.5 vertex moves half.
    const mesh = {
      positions: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      joints: [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
      weights: [1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0],
    };
    const bones = [identity(), translation([10, 0, 0])];
    const { positions } = skinMesh(mesh, bones);
    expect([positions[0], positions[1], positions[2]]).toEqual([0, 0, 0]); // bone0
    expect([positions[3], positions[4], positions[5]]).toEqual([10, 0, 0]); // bone1
    expect([positions[6], positions[7], positions[8]]).toEqual([5, 0, 0]); // half/half
  });

  it("rotates a normal by the blended bone's rotation and re-normalizes it", () => {
    // A vertex fully on a bone rotated 90° about x: its +z normal maps to +y (the
    // pitch convention) and stays unit length. Translation must not affect normals.
    const mesh = {
      positions: [0, 0, 0],
      normals: [0, 0, 1],
      joints: [0, 0, 0, 0],
      weights: [1, 0, 0, 0],
    };
    const { normals } = skinMesh(mesh, [rotation("x", Math.PI / 2)]);
    expect(normals[0]).toBeCloseTo(0, 6);
    expect(normals[1]).toBeCloseTo(1, 6); // +z → +y
    expect(normals[2]).toBeCloseTo(0, 6);
    expect(Math.hypot(normals[0]!, normals[1]!, normals[2]!)).toBeCloseTo(1, 6);
  });
});

describe("skinningMatrices + skinMesh (procedural rig driving)", () => {
  it("is undeformed at rest (every skinning matrix is the identity)", () => {
    const mesh = parseSkinnedGlb(readGlb("skinned-bar.glb"));
    const bones = skinningMatrices(barRig, mesh, { caller: {} });
    const { positions } = skinMesh(mesh, bones);
    // Every skinned vertex equals its bind position (compare the top vertex at y=2).
    expect([positions[12], positions[13], positions[14]]).toEqual([
      mesh.positions[12],
      mesh.positions[13],
      mesh.positions[14],
    ]);
  });

  it("a bone rotation deforms the vertices bound to that bone, and only those", () => {
    const mesh = parseSkinnedGlb(readGlb("skinned-bar.glb"));
    const bones = skinningMatrices(barRig, mesh, { caller: { spine_bend: 0.5 } });
    const { positions } = skinMesh(mesh, bones);

    // Bottom vertex 0 (y=0) is weighted fully to the pelvis (root, unmoved): it stays.
    expect([positions[0], positions[1], positions[2]]).toEqual([0, 0, 0]);

    // Top vertex 4 (bind pos (0,2,0)) is weighted fully to the spine, which bends
    // about x through the head at y=1: (0,2,0) → (0, 1+cos θ, −sin θ).
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    expect(positions[12]).toBeCloseTo(0, 6);
    expect(positions[13]).toBeCloseTo(1 + c, 6);
    expect(positions[14]).toBeCloseTo(-s, 6);
    // It genuinely moved off its bind position.
    expect(positions[14]).not.toBeCloseTo(0, 3);
  });

  it("holds a bone with no matching rig part at bind pose (identity)", () => {
    const mesh = parseSkinnedGlb(readGlb("skinned-bar.glb"));
    // A rig that names neither bone: both bones fall back to identity, no deformation.
    const emptyRig: ModelSpec = { parts: [part("nothing")], joints: [] };
    const bones = skinningMatrices(emptyRig, mesh, { caller: { spine_bend: 0.5 } });
    for (const m of bones) {
      expect(Array.from(m)).toEqual(Array.from(identity()));
    }
  });
});
