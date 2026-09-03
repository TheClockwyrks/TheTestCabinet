import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Model } from "@test-cabinet/structured-3d";
import { CREAK_THRESHOLD, VOXELS_PER_UNIT } from "../constants";
import { OVER_LIMIT, utilizationColour } from "../palette";
import { boxOf, disposeTree, place, poseBar, Pool } from "./three-kit";
import { buildPad, fixtureSignature } from "./site";
import { memberHeat } from "./crane";
import { MODEL_SCALE, modelAnchor, placementOffset } from "./parts";
import { yardPosture } from "../posture";
import { GantryState } from "../game";

describe("Pool", () => {
  it("builds on demand, reuses, and hides what a quieter frame leaves", () => {
    const parent = new THREE.Group();
    const pool = new Pool(parent, () => new THREE.Object3D());
    pool.begin();
    const first = pool.take();
    pool.take();
    pool.end();
    expect(pool.size).toBe(2);
    expect(parent.children).toHaveLength(2);

    pool.begin();
    expect(pool.take()).toBe(first);
    pool.end();
    expect(pool.taken).toBe(1);
    expect(parent.children[1].visible).toBe(false);
  });
});

describe("poseBar", () => {
  it("stands a unit bar between two points, at its own thickness", () => {
    const bar = new THREE.Object3D();
    poseBar(bar, [0, 0, 0], [0, 4, 0], 0.2, 0.2);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    bar.matrix.decompose(position, new THREE.Quaternion(), scale);
    expect(position.toArray()).toEqual([0, 2, 0]);
    expect(scale.y).toBeCloseTo(4, 6);
    // A vertical bar's basis is left-handed by construction, so `decompose`
    // reports the negative on one axis; what matters is the thickness.
    expect(Math.abs(scale.x)).toBeCloseTo(0.2, 6);
    expect(Math.abs(scale.z)).toBeCloseTo(0.2, 6);
  });

  it("hides a bar with no length at all", () => {
    const bar = new THREE.Object3D();
    poseBar(bar, [1, 1, 1], [1, 1, 1], 0.2, 0.2);
    expect(bar.visible).toBe(false);
  });

  it("keeps a vertical bar's across axis usable", () => {
    const bar = new THREE.Object3D();
    poseBar(bar, [0, 0, 0], [0, 1, 0], 1, 1);
    expect(Number.isNaN(bar.matrix.elements[0])).toBe(false);
  });
});

describe("place", () => {
  it("stands a group at a placement, turned by its yaw", () => {
    const group = new THREE.Object3D();
    place(group, { centre: [1, 9, 2], baseY: 3, yaw: 90 });
    expect(group.position.toArray()).toEqual([1, 3, 2]);
    expect(group.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe("boxOf", () => {
  it("reads a box as the centre and the size a geometry takes", () => {
    expect(boxOf({ min: [0, 0, 0], max: [2, 4, 6] })).toEqual({
      centre: [1, 2, 3],
      size: [2, 4, 6],
    });
  });
});

describe("memberHeat", () => {
  it("reads the ramp below the limit and leaves it above", () => {
    expect(memberHeat(0.2, 0).colour).toBe(utilizationColour(0.2));
    expect(memberHeat(0.2, 0).glow).toBe(0);
    expect(memberHeat(CREAK_THRESHOLD, 0).glow).toBeGreaterThan(0);
    expect(memberHeat(1.4, 0).colour).toBe(OVER_LIMIT);
  });

  it("pulses a member past its limit", () => {
    const a = memberHeat(1.4, 0).glow;
    const b = memberHeat(1.4, Math.PI / 28).glow;
    expect(a).not.toBeCloseTo(b, 3);
  });
});

describe("the site's fixtures", () => {
  it("changes its signature only when the site does", () => {
    const state = new GantryState();
    const first = fixtureSignature(yardPosture(state));
    expect(fixtureSignature(yardPosture(state))).toBe(first);
    state.site = { loads: [], obstacles: state.site.obstacles };
    expect(fixtureSignature(yardPosture(state))).not.toBe(first);
  });

  it("draws a pad as a footprint with a yaw mark", () => {
    const pad = buildPad({
      cls: "crate",
      pos: [4, 2, 0],
      yaw: 90,
      placed: false,
    });
    // The footprint, four edge bands, and the chevron.
    expect(pad.children).toHaveLength(6);
    expect(pad.position.y).toBeCloseTo(0.04, 9);
    expect(pad.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
    disposeTree(pad);
  });
});

describe("a produced model's placement", () => {
  /** A model of a given voxel size, standing from the origin. */
  function stub(width: number, height: number): Model {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, width));
    mesh.position.set(width / 2, height / 2, width / 2);
    scene.add(mesh);
    return { scene, animations: [], nodes: [] };
  }

  it("draws every model at one voxel-unit scale", () => {
    expect(MODEL_SCALE).toBe(1 / VOXELS_PER_UNIT);
  });

  it("finds the footprint centre at the model's lowest point", () => {
    expect(modelAnchor(stub(16, 8))).toEqual({ x: 8, y: 0, z: 8 });
  });

  it("puts the model's footprint centre and base on the placement", () => {
    const anchor = modelAnchor(stub(16, 8));
    const offset = placementOffset(anchor, {
      centre: [4, 0, -2],
      baseY: 6,
      yaw: 0,
    });
    // The anchor is a unit across at 1/8 scale, so the origin sits a unit away.
    expect(offset.position.x).toBeCloseTo(3, 9);
    expect(offset.position.y).toBeCloseTo(6, 9);
    expect(offset.position.z).toBeCloseTo(-3, 9);
  });

  it("turns the anchor with the placement's yaw", () => {
    const anchor = modelAnchor(stub(16, 8));
    const offset = placementOffset(anchor, {
      centre: [0, 0, 0],
      baseY: 0,
      yaw: 90,
    });
    // A positive yaw carries +x toward +z, so the offset it undoes turns too.
    expect(offset.position.x).toBeCloseTo(1, 6);
    expect(offset.position.z).toBeCloseTo(-1, 6);
  });
});
