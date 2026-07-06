import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { JointSpec, ModelSpec, PartSpec } from "../contract";
import { parseSkinnedGlb } from "../glb";
import { SkinnedVoxelRig } from "./SkinnedVoxelRig";

function readGlb(name: string): ArrayBuffer {
  const buf = readFileSync(fileURLToPath(new URL(`../__fixtures__/${name}`, import.meta.url)));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const part = (name: string, over: Partial<PartSpec> = {}): PartSpec => ({
  name,
  pivot: [0, 0, 0],
  ...over,
});
const bend: JointSpec = {
  name: "spine_bend",
  part: "spine",
  kind: "rotation",
  axis: "x",
  pivot: [0, 1, 0],
  min: -2,
  max: 2,
  rest: 0,
  drive: "caller",
};
const barRig: ModelSpec = {
  parts: [part("pelvis"), part("spine", { parent: "pelvis", pivot: [0, 1, 0] })],
  joints: [bend],
};

describe("SkinnedVoxelRig", () => {
  it("binds a THREE.SkinnedMesh + Skeleton with the skin attributes and bones", () => {
    const mesh = parseSkinnedGlb(readGlb("skinned-bar.glb"));
    const rig = new SkinnedVoxelRig(barRig, mesh);

    expect(rig.mesh).toBeInstanceOf(THREE.SkinnedMesh);
    expect(rig.mesh.skeleton.bones.length).toBe(2);
    expect(rig.mesh.skeleton.bones.map((b) => b.name)).toEqual(["pelvis", "spine"]);
    // GPU skin attributes are present with 4 components per vertex.
    const geo = rig.mesh.geometry;
    expect(geo.getAttribute("skinIndex").itemSize).toBe(4);
    expect(geo.getAttribute("skinIndex").count).toBe(6);
    expect(geo.getAttribute("skinWeight").count).toBe(6);
    // Detached bind: a transform on root doesn't disturb the skin binding.
    expect(rig.mesh.bindMode).toBe(THREE.DetachedBindMode);
    rig.dispose();
  });

  it("drives the spine bone's world matrix from a caller joint value", () => {
    const mesh = parseSkinnedGlb(readGlb("skinned-bar.glb"));
    const rig = new SkinnedVoxelRig(barRig, mesh);
    const spine = rig.mesh.skeleton.bones.find((b) => b.name === "spine")!;

    // At rest the spine bone is the identity.
    expect(spine.matrix.elements[14]).toBeCloseTo(0, 6);

    // Bending the spine 0.5 rad about x through its head at y=1 moves the bone
    // origin: T(0,1,0)·Rx·T(0,-1,0) maps (0,0,0) → (0, 1−cos, sin) in the last column.
    rig.pose({ spine_bend: 0.5 });
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    expect(spine.matrix.elements[13]).toBeCloseTo(1 - c, 6); // translation y
    expect(spine.matrix.elements[14]).toBeCloseTo(s, 6); // translation z
    rig.dispose();
  });

  it("plays an auto-play animation forward off the clock", () => {
    const mesh = parseSkinnedGlb(readGlb("skinned-bar.glb"));
    const rigWithIdle: ModelSpec = {
      ...barRig,
      animations: [
        {
          name: "idle",
          periodMs: 1000,
          looping: true,
          autoPlay: true,
          joints: ["spine_bend"],
          tracks: [
            {
              joint: "spine_bend",
              keyframes: [
                { tMs: 0, value: 0, interp: "linear" },
                { tMs: 500, value: 1, interp: "linear" },
                { tMs: 1000, value: 0, interp: "linear" },
              ],
            },
          ],
        },
      ],
    };
    const rig = new SkinnedVoxelRig(rigWithIdle, mesh);
    const spine = rig.mesh.skeleton.bones.find((b) => b.name === "spine")!;
    const restZ = spine.matrix.elements[14];
    rig.seek(500); // peak of the idle
    expect(spine.matrix.elements[14]).not.toBeCloseTo(restZ, 3);
    rig.dispose();
  });
});
