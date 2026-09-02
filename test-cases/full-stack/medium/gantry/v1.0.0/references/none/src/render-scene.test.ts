import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import { HOIST_START, VOXELS_PER_UNIT } from "./constants";
import { MODEL_NAMES, type ModelName } from "./assets";
import { classDimensions, type Vec3 } from "./sim";
import { cameraPosition, TARGET } from "./render-project";
import { YardScene } from "./render-scene";
import type { YardPosture } from "./render-posture";

// `three` builds a scene, its geometries, and its materials without a graphics
// context — only `WebGLRenderer` needs one — so the whole of the yard's layout
// can be built and read back here, in Node, with nothing drawn.

/**
 * A stub model: a unit-sized box of voxels, so its bounding box is known and
 * the placement arithmetic can be checked against it.
 */
function stubMesh(w: number, h: number, d: number): PartMesh {
  return {
    positions: [0, 0, 0, w, 0, 0, 0, h, 0, 0, 0, d],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    colors: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

const MODELS = Object.fromEntries(
  MODEL_NAMES.map((name) => [name, stubMesh(8, 8, 8)]),
) as Record<ModelName, PartMesh>;

const EMPTY: YardPosture = {
  slew: 0,
  live: false,
  members: [],
  counterweights: [],
  ring: null,
  trolley: null,
  hook: null,
  cable: null,
  loads: [],
  pads: [],
  anchors: [],
  obstacles: [],
  envelope: { min: [0, 0, 0], max: [8, 8, 8] },
};

const NO_AIDS = { lattice: false, pick: null, pending: null };

/** Every visible object of a name, wherever it sits in the scene. */
function visible(scene: THREE.Object3D, name: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.name === name && object.visible) found.push(object);
  });
  return found;
}

const at = (object: THREE.Object3D): Vec3 => [
  object.position.x,
  object.position.y,
  object.position.z,
];

describe("the scene it builds once", () => {
  it("carries a sky, a ground, and light", () => {
    const yard = new YardScene(MODELS);
    let lights = 0;
    let meshes = 0;
    yard.scene.traverse((object) => {
      if ((object as THREE.Light).isLight) lights += 1;
      if ((object as THREE.Mesh).isMesh) meshes += 1;
    });
    expect(lights).toBeGreaterThanOrEqual(2);
    expect(meshes).toBeGreaterThanOrEqual(2);
    yard.dispose();
  });

  it("draws every produced model at one voxel-scale", () => {
    const yard = new YardScene(MODELS);
    yard.sync({ ...EMPTY, anchors: [[0, 0, 0]] }, NO_AIDS, 0);
    const mount = visible(yard.scene, "mount")[0];
    const mesh = mount.children[0] as THREE.Mesh;
    expect(mesh.scale.x).toBeCloseTo(1 / VOXELS_PER_UNIT, 9);
    yard.dispose();
  });
});

describe("poseCamera", () => {
  it("stands the camera where the orbit pose puts it, looking at the target", () => {
    const yard = new YardScene(MODELS);
    const pose = { yaw: 45, pitch: 30, dist: 40 };
    yard.poseCamera(pose);
    const eye = cameraPosition(pose);
    expect(yard.camera.position.x).toBeCloseTo(eye[0], 9);
    expect(yard.camera.position.y).toBeCloseTo(eye[1], 9);
    expect(yard.camera.position.z).toBeCloseTo(eye[2], 9);
    // It looks back at the target: the forward axis points from eye to target.
    yard.camera.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      yard.camera.quaternion,
    );
    const wanted = new THREE.Vector3(...TARGET)
      .sub(yard.camera.position)
      .normalize();
    expect(forward.dot(wanted)).toBeCloseTo(1, 9);
    yard.dispose();
  });
});

describe("the models stand where their subjects are", () => {
  const posture = (over: Partial<YardPosture>): YardPosture => ({
    ...EMPTY,
    ...over,
  });

  it("puts a mount at every anchor", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      posture({
        anchors: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 0, 2],
        ],
      }),
      NO_AIDS,
      0,
    );
    const mounts = visible(yard.scene, "mount");
    expect(mounts).toHaveLength(3);
    expect(mounts.map(at)).toEqual([
      [0, 0, 0],
      [2, 0, 0],
      [0, 0, 2],
    ]);
    yard.dispose();
  });

  it("centres the ring on the slew axis and turns it with the arm", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      posture({
        slew: 90,
        ring: { centre: [1, 3, 1], baseY: 2, yaw: 90 },
      }),
      NO_AIDS,
      0,
    );
    const ring = visible(yard.scene, "ring")[0];
    expect(at(ring)).toEqual([1, 2, 1]);
    // A positive yaw carries `+x` toward `+z`, which is a negative turn about
    // `three`'s own `+y`.
    expect(ring.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
    yard.dispose();
  });

  it("hangs the hook at the bob, turned to the grip", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      posture({
        trolley: { centre: [4, 6, 0], baseY: 6, yaw: 0 },
        hook: { centre: [4, 6 - HOIST_START, 0], baseY: 4, yaw: 45 },
        cable: { from: [4, 6, 0], to: [4, 4, 0] },
      }),
      NO_AIDS,
      0,
    );
    const hook = visible(yard.scene, "hook")[0];
    expect(at(hook)).toEqual([4, 4, 0]);
    expect(hook.rotation.y).toBeCloseTo((-45 * Math.PI) / 180, 9);
    expect(visible(yard.scene, "trolley")).toHaveLength(1);
    // The hoist cable is drawn as its own rope, pivot to bob.
    expect(visible(yard.scene, "rope").length).toBeGreaterThan(0);
    yard.dispose();
  });

  it("stands each load on its own base, at its own yaw", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      posture({
        loads: [
          { cls: "crate", pos: [6, 2, 0], yaw: 0, phase: "waiting" },
          { cls: "drum", pos: [0, 3, 4], yaw: 90, phase: "waiting" },
        ],
      }),
      NO_AIDS,
      0,
    );
    const crate = visible(yard.scene, "crate")[0];
    const drum = visible(yard.scene, "drum")[0];
    // A load's pose is its lift point — the centre of its top face — so its
    // model stands a class height below it (`specs/world.md`).
    expect(at(crate)).toEqual([6, 2 - classDimensions("crate")[1], 0]);
    expect(at(drum)).toEqual([0, 3 - classDimensions("drum")[1], 4]);
    expect(drum.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
    yard.dispose();
  });

  it("hangs a counterweight on every node carrying one", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      posture({
        counterweights: [
          [0, 6, 0],
          [4, 6, 0],
        ],
      }),
      NO_AIDS,
      0,
    );
    expect(visible(yard.scene, "counterweight")).toHaveLength(2);
    yard.dispose();
  });

  it("takes a model back out of the scene when its subject goes", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      posture({
        anchors: [
          [0, 0, 0],
          [2, 0, 0],
        ],
      }),
      NO_AIDS,
      0,
    );
    expect(visible(yard.scene, "mount")).toHaveLength(2);
    yard.sync(posture({ anchors: [[0, 0, 0]] }), NO_AIDS, 0);
    expect(visible(yard.scene, "mount")).toHaveLength(1);
    yard.sync(posture({}), NO_AIDS, 0);
    expect(visible(yard.scene, "mount")).toHaveLength(0);
    yard.dispose();
  });
});

describe("the members", () => {
  const member = (
    id: number,
    a: Vec3,
    b: Vec3,
    material: "strut" | "cable" | "rail",
    utilization: number | null = null,
    broken = false,
  ): YardPosture["members"][number] => ({
    id,
    a,
    b,
    material,
    length: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
    utilization,
    broken,
  });

  it("poses a member between its two ends", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      { ...EMPTY, members: [member(0, [0, 0, 0], [0, 4, 0], "strut")] },
      NO_AIDS,
      0,
    );
    const bar = visible(yard.scene, "member")[0];
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    bar.matrix.decompose(position, quaternion, scale);
    // The bar's midpoint is the member's, and its own length axis spans it.
    expect(position.x).toBeCloseTo(0, 9);
    expect(position.y).toBeCloseTo(2, 9);
    expect(position.z).toBeCloseTo(0, 9);
    const along = new THREE.Vector3()
      .setFromMatrixColumn(bar.matrix, 1)
      .length();
    expect(along).toBeCloseTo(4, 9);
    yard.dispose();
  });

  it("gives a rail a second, raised piece, and a cable none", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      { ...EMPTY, members: [member(0, [0, 4, 0], [4, 4, 0], "rail")] },
      NO_AIDS,
      0,
    );
    // A rail is a wide flat beam with a raised head: two pieces, not one, so
    // it is told apart from a strut by form.
    expect(visible(yard.scene, "member")).toHaveLength(2);

    const cables = new YardScene(MODELS);
    cables.sync(
      { ...EMPTY, members: [member(0, [0, 0, 0], [0, 8, 0], "cable")] },
      NO_AIDS,
      0,
    );
    expect(visible(cables.scene, "member")).toHaveLength(0);
    expect(visible(cables.scene, "rope")).toHaveLength(1);
    yard.dispose();
    cables.dispose();
  });

  it("colours a member by its utilization, and only once one is known", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      { ...EMPTY, members: [member(0, [0, 0, 0], [0, 4, 0], "strut")] },
      NO_AIDS,
      0,
    );
    const bar = visible(yard.scene, "member")[0] as THREE.Mesh;
    const resting = (bar.material as THREE.MeshLambertMaterial).color.getHex();

    yard.sync(
      { ...EMPTY, members: [member(0, [0, 0, 0], [0, 4, 0], "strut", 0.95)] },
      NO_AIDS,
      0,
    );
    const hot = (bar.material as THREE.MeshLambertMaterial).color.getHex();
    expect(hot).not.toBe(resting);

    yard.sync(
      { ...EMPTY, members: [member(0, [0, 0, 0], [0, 4, 0], "strut", 1.4)] },
      NO_AIDS,
      0,
    );
    const material = bar.material as THREE.MeshLambertMaterial;
    expect(material.color.getHex()).not.toBe(hot);
    // Past its limit a member glows as well as changing colour, so it does not
    // read by hue alone.
    expect(material.emissiveIntensity).toBeGreaterThan(0);
    yard.dispose();
  });

  it("draws a broken member apart from the intact ones, and see-through", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      {
        ...EMPTY,
        members: [
          member(0, [0, 0, 0], [0, 4, 0], "strut", 0.2),
          member(1, [0, 4, 0], [4, 4, 0], "strut", null, true),
        ],
      },
      NO_AIDS,
      0,
    );
    expect(visible(yard.scene, "member")).toHaveLength(1);
    const broken = visible(yard.scene, "broken")[0] as THREE.Mesh;
    const material = broken.material as THREE.MeshLambertMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);
    yard.dispose();
  });
});

describe("the build aids", () => {
  it("shows the lattice only when it is asked for", () => {
    const yard = new YardScene(MODELS);
    const points = (): THREE.Object3D[] => {
      const found: THREE.Object3D[] = [];
      yard.scene.traverse((object) => {
        if ((object as THREE.Points).isPoints && object.visible) {
          found.push(object);
        }
      });
      return found;
    };
    yard.sync(EMPTY, { lattice: true, pick: null, pending: null }, 0);
    expect(points()).toHaveLength(1);
    yard.sync(EMPTY, NO_AIDS, 0);
    expect(points()).toHaveLength(0);
    yard.dispose();
  });

  it("marks the picked node and the pending node, apart from one another", () => {
    const yard = new YardScene(MODELS);
    yard.sync(EMPTY, { lattice: false, pick: [2, 4, 0], pending: null }, 0);
    expect(visible(yard.scene, "marker")).toHaveLength(1);

    yard.sync(
      { ...EMPTY },
      { lattice: false, pick: [2, 4, 0], pending: [0, 2, 0] },
      0,
    );
    const markers = visible(yard.scene, "marker");
    expect(markers).toHaveLength(2);
    expect(at(markers[0])).toEqual([2, 4, 0]);
    expect(at(markers[1])).toEqual([0, 2, 0]);
    // The held node is the bigger of the two, and a different colour.
    expect(markers[1].scale.x).toBeGreaterThan(markers[0].scale.x);
    const colours = markers.map((m) =>
      ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex(),
    );
    expect(colours[0]).not.toBe(colours[1]);

    yard.sync(EMPTY, NO_AIDS, 0);
    expect(visible(yard.scene, "marker")).toHaveLength(0);
    yard.dispose();
  });
});

describe("the site's fixtures", () => {
  const fixtures = (yard: YardScene): THREE.Object3D =>
    yard.scene.getObjectByName("fixtures") as THREE.Object3D;

  it("builds the envelope, the obstacles, and a pad for every load", () => {
    const yard = new YardScene(MODELS);
    yard.sync(
      {
        ...EMPTY,
        anchors: [[0, 0, 0]],
        obstacles: [{ min: [5, 0, -6], max: [6, 8, 6] }],
        pads: [
          { cls: "crate", pos: [0, 2, 10], yaw: 0, placed: false },
          { cls: "container", pos: [-7, 8, 0], yaw: 90, placed: false },
        ],
      },
      NO_AIDS,
      0,
    );
    expect(fixtures(yard).children.length).toBeGreaterThan(4);
    yard.dispose();
  });

  it("rebuilds them only when the site itself changes", () => {
    const yard = new YardScene(MODELS);
    const site: YardPosture = {
      ...EMPTY,
      anchors: [[0, 0, 0]],
      pads: [{ cls: "crate", pos: [0, 2, 10], yaw: 0, placed: false }],
    };
    yard.sync(site, NO_AIDS, 0);
    const before = fixtures(yard).children[0];
    // The crane moving does not rebuild the yard around it.
    yard.sync({ ...site, slew: 42 }, NO_AIDS, 0);
    expect(fixtures(yard).children[0]).toBe(before);
    // Moving a pad does.
    yard.sync(
      {
        ...site,
        pads: [{ cls: "crate", pos: [4, 2, 10], yaw: 0, placed: false }],
      },
      NO_AIDS,
      0,
    );
    expect(fixtures(yard).children[0]).not.toBe(before);
    yard.dispose();
  });
});
