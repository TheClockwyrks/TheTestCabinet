// The yard: the `three` scene Gantry's 3D picture is drawn in.
//
// The scene is retained and posed. It is built once — sky, ground, light — and
// each frame the site's fixtures and the crane are laid out over the reading
// `src/render-posture.ts` takes of the state. Nothing here decides a rule or
// writes to the state; it is handed a posture and arranges objects to match.
//
// Everything but the eight produced models of `specs/assets.md` is drawn in
// code: the ground and its survey grid, the sky dome, the lattice and envelope
// aids, the members, the hoist cable, the obstacles, and the pads with their
// yaw marks.

import * as THREE from "three";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import { buildPartGeometry } from "@test-cabinet/voxel-runtime/three";
import type { ModelName } from "./assets";
import { CREAK_THRESHOLD, LATTICE_PITCH, VOXELS_PER_UNIT } from "./constants";
import { classDimensions, DEG, nodeKey, type Box, type Vec3 } from "./sim";
import { CAMERA_FOV, STAGE_ASPECT, TARGET } from "./render-project";
import {
  ANCHOR_PLATE,
  BROKEN,
  ENVELOPE,
  GROUND,
  GROUND_GRID,
  HOIST_CABLE,
  LATTICE,
  LIGHT_GROUND,
  LIGHT_SKY,
  LIGHT_SUN,
  lighten,
  materialColour,
  OBSTACLE,
  OBSTACLE_EDGE,
  OVER_LIMIT,
  PAD,
  PENDING_NODE,
  PICK_NODE,
  RAIL_HEAD,
  SKY_HORIZON,
  SKY_ZENITH,
  utilizationColour,
} from "./render-palette";
import type { Placement, YardPosture } from "./render-posture";
import { latticeNodes } from "./render-posture";
import type { Camera } from "./state";
import { cameraPosition } from "./render-project";

/** The scale every produced model is drawn at (`specs/assets.md`). */
const MODEL_SCALE = 1 / VOXELS_PER_UNIT;

/** How thick each material is drawn, across and through its own length. */
export const PROFILE: Readonly<
  Record<string, { across: number; through: number }>
> = {
  strut: { across: 0.17, through: 0.17 },
  rail: { across: 0.46, through: 0.15 },
  cable: { across: 0.075, through: 0.075 },
};

/** How far the yard floor reaches, on each axis (`specs/overview.md`). */
export const GROUND_SIZE = 600;

export const BROKEN_PROFILE = { across: 0.09, through: 0.09 };
const HOIST_RADIUS = 0.06;

// ---- Small helpers ---------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** A pool of one kind of object, taken and released a frame at a time. */
class Pool<T extends THREE.Object3D> {
  private readonly items: T[] = [];
  private used = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly make: () => T,
  ) {}

  begin(): void {
    this.used = 0;
  }

  take(): T {
    let item = this.items[this.used];
    if (item === undefined) {
      item = this.make();
      this.items.push(item);
      this.parent.add(item);
    }
    item.visible = true;
    this.used += 1;
    return item;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) {
      this.items[i].visible = false;
    }
  }
}

/**
 * Pose a bar of unit geometry between two world points, with a chosen
 * cross-section. The bar's own frame is built from its direction so the
 * "across" axis is horizontal for any member that is not vertical, which is
 * what makes a rail's flat profile read as a track.
 */
function poseBar(
  object: THREE.Object3D,
  a: Vec3,
  b: Vec3,
  across: number,
  through: number,
  lift = 0,
): void {
  const from = new THREE.Vector3(a[0], a[1], a[2]);
  const to = new THREE.Vector3(b[0], b[1], b[2]);
  const along = to.clone().sub(from);
  const length = along.length();
  if (length < 1e-9) {
    object.visible = false;
    return;
  }
  const dir = along.clone().divideScalar(length);
  let side = new THREE.Vector3().crossVectors(UP, dir);
  if (side.lengthSq() < 1e-9) side = new THREE.Vector3(1, 0, 0);
  side.normalize();
  const other = new THREE.Vector3().crossVectors(dir, side).normalize();
  const centre = from.clone().add(to).multiplyScalar(0.5);
  if (lift !== 0) centre.addScaledVector(other, lift);
  object.matrixAutoUpdate = false;
  object.matrix.makeBasis(
    side.multiplyScalar(across),
    dir.clone().multiplyScalar(length),
    other.clone().multiplyScalar(through),
  );
  object.matrix.setPosition(centre);
  object.matrixWorldNeedsUpdate = true;
}

/** Stand a produced model where its subject is (`specs/assets.md`). */
function place(group: THREE.Object3D, placement: Placement): void {
  group.matrixAutoUpdate = true;
  group.position.set(placement.centre[0], placement.baseY, placement.centre[2]);
  // A positive yaw carries `+x` toward `+z` (`specs/world.md`), which is a
  // negative rotation about `three`'s own `+y`.
  group.rotation.set(0, -placement.yaw * DEG, 0);
}

const boxOf = (box: Box): { centre: Vec3; size: Vec3 } => ({
  centre: [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ],
  size: [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ],
});

// ---- The scene -------------------------------------------------------------

/** One decoded model, ready to stand somewhere. */
interface ModelEntry {
  readonly geometry: THREE.BufferGeometry;
  /** The offset that puts the model's footprint centre and base at the origin. */
  readonly offset: THREE.Vector3;
}

/** The retained yard, posed from the state each frame. */
export class YardScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    STAGE_ASPECT,
    0.5,
    600,
  );

  private readonly models: Record<string, ModelEntry> = {};
  private readonly sun = new THREE.DirectionalLight(LIGHT_SUN, 2.6);

  private readonly barGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly ropeGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  private readonly nodeGeometry = new THREE.OctahedronGeometry(0.42);

  private readonly fixtures = Object.assign(new THREE.Group(), {
    name: "fixtures",
  });
  private fixtureKey = "";

  private readonly memberPool: Pool<THREE.Mesh>;
  private readonly ropePool: Pool<THREE.Mesh>;
  /**
   * Broken members keep a pool of their own. A pooled mesh is reused for a
   * different member each frame, and flipping one material between opaque and
   * transparent recompiles its shader, so the one translucent kind is kept
   * apart from the opaque ones.
   */
  private readonly brokenPool: Pool<THREE.Mesh>;
  private readonly modelPool: Record<string, Pool<THREE.Group>> = {};
  private readonly markerPool: Pool<THREE.Mesh>;

  constructor(models: Readonly<Record<ModelName, PartMesh>>) {
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 90, 340);
    this.buildSky();
    this.buildGround();
    this.buildLight();
    this.scene.add(this.fixtures);

    for (const [name, mesh] of Object.entries(models)) {
      const geometry = buildPartGeometry(mesh);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox ?? new THREE.Box3();
      this.models[name] = {
        geometry,
        offset: new THREE.Vector3(
          -((bounds.min.x + bounds.max.x) / 2) * MODEL_SCALE,
          -bounds.min.y * MODEL_SCALE,
          -((bounds.min.z + bounds.max.z) / 2) * MODEL_SCALE,
        ),
      };
    }

    const crane = new THREE.Group();
    crane.name = "crane";
    this.scene.add(crane);
    this.memberPool = new Pool(crane, () => this.makeBar(this.barGeometry));
    this.ropePool = new Pool(crane, () =>
      this.makeBar(this.ropeGeometry, "rope"),
    );
    this.brokenPool = new Pool(crane, () => {
      const mesh = this.makeBar(this.barGeometry, "broken");
      const material = mesh.material as THREE.MeshLambertMaterial;
      material.transparent = true;
      material.opacity = 0.55;
      material.color.setHex(BROKEN);
      return mesh;
    });
    this.markerPool = new Pool(crane, () => this.makeMarker());
    for (const name of Object.keys(this.models)) {
      this.modelPool[name] = new Pool(crane, () => this.makeModel(name));
    }
  }

  // ---- The parts of the scene that never change ---------------------------

  private buildSky(): void {
    const geometry = new THREE.SphereGeometry(420, 24, 16);
    const colours = new Float32Array(geometry.attributes.position.count * 3);
    const position = geometry.attributes.position;
    const horizon = new THREE.Color(SKY_HORIZON);
    const zenith = new THREE.Color(SKY_ZENITH);
    const colour = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, Math.min(1, (position.getY(i) / 420) * 3 + 0.06));
      colour.copy(horizon).lerp(zenith, t);
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const dome = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    dome.renderOrder = -1;
    this.scene.add(dome);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshLambertMaterial({ color: GROUND }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // The survey grid ruled over the yard, on the lattice's own pitch.
    const half = 48;
    const points: number[] = [];
    for (let i = -half; i <= half; i += LATTICE_PITCH) {
      points.push(i, 0, -half, i, 0, half, -half, 0, i, half, 0, i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    const grid = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: GROUND_GRID,
        transparent: true,
        opacity: 0.28,
      }),
    );
    grid.position.y = 0.005;
    this.scene.add(grid);
  }

  private buildLight(): void {
    this.scene.add(new THREE.HemisphereLight(LIGHT_SKY, LIGHT_GROUND, 2.2));
    const sun = this.sun;
    sun.position.set(34, 52, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const shadow = sun.shadow.camera;
    shadow.near = 1;
    shadow.far = 180;
    shadow.left = -40;
    shadow.right = 40;
    shadow.top = 40;
    shadow.bottom = -40;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  // ---- Object factories ---------------------------------------------------

  private makeBar(geometry: THREE.BufferGeometry, name = "member"): THREE.Mesh {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    mesh.name = name;
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  private makeMarker(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.nodeGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        // A marker is an aid rather than a body: it is drawn over everything,
        // so the node under the pointer and the node being held are visible
        // even where the crane already stands around them.
        depthTest: false,
        fog: false,
      }),
    );
    mesh.renderOrder = 6;
    mesh.name = "marker";
    return mesh;
  }

  private makeModel(name: string): THREE.Group {
    const entry = this.models[name];
    const group = new THREE.Group();
    // Named after the model it stands for, so the scene can be read back —
    // by a test, and by `three`'s own inspector.
    group.name = name;
    const mesh = new THREE.Mesh(
      entry.geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(MODEL_SCALE);
    mesh.position.copy(entry.offset);
    group.add(mesh);
    return group;
  }

  // ---- The site's own fixtures --------------------------------------------

  /** A cheap identity for the fixtures, so they are rebuilt only when posed. */
  private static fixtureSignature(posture: YardPosture): string {
    return [
      posture.envelope.min.join(","),
      posture.envelope.max.join(","),
      posture.anchors.map(nodeKey).join("|"),
      posture.obstacles
        .map((o) => `${o.min.join(",")}/${o.max.join(",")}`)
        .join("|"),
      posture.pads.map((p) => `${p.cls}${p.pos.join(",")}@${p.yaw}`).join("|"),
    ].join(";");
  }

  private buildFixtures(posture: YardPosture): void {
    for (const child of [...this.fixtures.children]) {
      this.fixtures.remove(child);
      disposeTree(child);
    }

    // The envelope's extent: the box the crane may be built inside.
    const envelope = boxOf(posture.envelope);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          envelope.size[0],
          envelope.size[1],
          envelope.size[2],
        ),
      ),
      new THREE.LineBasicMaterial({
        color: ENVELOPE,
        transparent: true,
        opacity: 0.8,
      }),
    );
    outline.position.set(...envelope.centre);
    this.fixtures.add(outline);

    // The buildable lattice, as a field of points.
    const nodes = latticeNodes(posture.envelope);
    const positions = new Float32Array(nodes.length * 3);
    nodes.forEach((node, i) => {
      positions[i * 3] = node[0];
      positions[i * 3 + 1] = node[1];
      positions[i * 3 + 2] = node[2];
    });
    const latticeGeometry = new THREE.BufferGeometry();
    latticeGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.fixtures.add(
      new THREE.Points(
        latticeGeometry,
        new THREE.PointsMaterial({
          color: LATTICE,
          size: 0.3,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
        }),
      ),
    );

    // The anchors: a plate ruled on the ground under each mount.
    for (const anchor of posture.anchors) {
      const plate = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.02, 20),
        new THREE.MeshBasicMaterial({
          color: ANCHOR_PLATE,
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
        }),
      );
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(anchor[0], anchor[1] + 0.03, anchor[2]);
      this.fixtures.add(plate);
    }

    // The obstacles: solid, edged, and nothing may reach inside them.
    for (const obstacle of posture.obstacles) {
      const { centre, size } = boxOf(obstacle);
      const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshLambertMaterial({ color: OBSTACLE }),
      );
      mesh.position.set(...centre);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.fixtures.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: OBSTACLE_EDGE }),
      );
      edges.position.set(...centre);
      this.fixtures.add(edges);
    }

    // The pads: each load's footprint at its required yaw, with a yaw mark.
    for (const pad of posture.pads) {
      this.fixtures.add(buildPad(pad.cls, pad.pos, pad.yaw));
    }
  }

  // ---- Posing -------------------------------------------------------------

  /** Point the camera at the yard from the orbit pose the state holds. */
  poseCamera(camera: Camera): void {
    const eye = cameraPosition(camera);
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
    this.sun.target.position.set(TARGET[0], 0, TARGET[2]);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Lay the crane, the loads, and the site's fixtures out for one frame.
   *
   * `aids` turns the lattice field and the two build markers on: they belong to
   * the build screen, where the player is placing on the lattice.
   */
  sync(
    posture: YardPosture,
    aids: { lattice: boolean; pick: Vec3 | null; pending: Vec3 | null },
    pulse: number,
  ): void {
    const key = YardScene.fixtureSignature(posture);
    if (key !== this.fixtureKey) {
      this.fixtureKey = key;
      this.buildFixtures(posture);
    }
    for (const child of this.fixtures.children) {
      if (child instanceof THREE.Points) child.visible = aids.lattice;
    }

    this.memberPool.begin();
    this.ropePool.begin();
    this.brokenPool.begin();
    this.markerPool.begin();
    for (const pool of Object.values(this.modelPool)) pool.begin();

    this.syncMembers(posture, pulse);
    this.syncRigging(posture);
    this.syncModels(posture);
    this.syncMarkers(aids.pick, aids.pending, pulse);

    this.memberPool.end();
    this.ropePool.end();
    this.brokenPool.end();
    this.markerPool.end();
    for (const pool of Object.values(this.modelPool)) pool.end();
  }

  private syncMembers(posture: YardPosture, pulse: number): void {
    for (const member of posture.members) {
      if (member.broken) {
        // A broken member is charred, thin, and see-through: plainly still
        // drawn where it stood, and plainly carrying nothing.
        poseBar(
          this.brokenPool.take(),
          member.a,
          member.b,
          BROKEN_PROFILE.across,
          BROKEN_PROFILE.through,
        );
        continue;
      }

      const profile = PROFILE[member.material] ?? PROFILE.strut;
      const bar =
        member.material === "cable"
          ? this.ropePool.take()
          : this.memberPool.take();
      poseBar(bar, member.a, member.b, profile.across, profile.through);

      const utilization = member.utilization;
      if (utilization === null) {
        paint(bar, materialColour(member.material), 0);
      } else {
        const colour =
          utilization > 1 ? OVER_LIMIT : utilizationColour(utilization);
        // Past the creak threshold a member glows, and past its limit it
        // pulses, so a member at breaking point is not read by hue alone.
        const glow =
          utilization > 1
            ? 0.45 + 0.35 * Math.sin(pulse * 14)
            : utilization >= CREAK_THRESHOLD
              ? 0.28
              : 0;
        paint(bar, colour, glow);
      }

      if (member.material === "rail") {
        // The head is the same colour as the beam under it, lifted a little
        // for the light: a rail is told apart by its FORM, and during a run its
        // utilization must read on the whole member rather than the web alone.
        const head = this.memberPool.take();
        poseBar(
          head,
          member.a,
          member.b,
          0.18,
          0.07,
          profile.through / 2 + 0.04,
        );
        const body =
          utilization === null
            ? RAIL_HEAD
            : lighten(
                utilization > 1 ? OVER_LIMIT : utilizationColour(utilization),
                0.3,
              );
        paint(head, body, 0);
      }
    }
  }

  private syncRigging(posture: YardPosture): void {
    if (posture.cable === null) return;
    const rope = this.ropePool.take();
    poseBar(
      rope,
      posture.cable.from,
      posture.cable.to,
      HOIST_RADIUS,
      HOIST_RADIUS,
    );
    paint(rope, HOIST_CABLE, 0);
  }

  private syncModels(posture: YardPosture): void {
    for (const anchor of posture.anchors) {
      place(this.modelPool.mount.take(), {
        centre: anchor,
        baseY: anchor[1],
        yaw: 0,
      });
    }
    for (const node of posture.counterweights) {
      place(this.modelPool.counterweight.take(), {
        centre: node,
        baseY: node[1] - 0.75,
        yaw: posture.slew,
      });
    }
    if (posture.ring !== null) place(this.modelPool.ring.take(), posture.ring);
    if (posture.trolley !== null) {
      place(this.modelPool.trolley.take(), posture.trolley);
    }
    if (posture.hook !== null) place(this.modelPool.hook.take(), posture.hook);
    for (const load of posture.loads) {
      const dimensions = classDimensions(load.cls);
      place(this.modelPool[load.cls].take(), {
        centre: load.pos,
        baseY: load.pos[1] - dimensions[1],
        yaw: load.yaw,
      });
    }
  }

  private syncMarkers(
    pick: Vec3 | null,
    pending: Vec3 | null,
    pulse: number,
  ): void {
    if (pick !== null) {
      const marker = this.markerPool.take();
      marker.position.set(pick[0], pick[1], pick[2]);
      marker.scale.setScalar(1.15 + 0.12 * Math.sin(pulse * 6));
      paintBasic(marker, PICK_NODE, 0.95);
    }
    if (pending !== null) {
      // The held node is marked bigger and in the accent, so a player never
      // mistakes it for the node the pointer happens to be over.
      const marker = this.markerPool.take();
      marker.position.set(pending[0], pending[1], pending[2]);
      marker.scale.setScalar(1.75);
      paintBasic(marker, PENDING_NODE, 1);
    }
  }

  /** Release every GPU resource the scene holds. */
  dispose(): void {
    disposeTree(this.scene);
    this.barGeometry.dispose();
    this.ropeGeometry.dispose();
    this.nodeGeometry.dispose();
    for (const entry of Object.values(this.models)) entry.geometry.dispose();
  }
}

// ---- Painting --------------------------------------------------------------

function paint(mesh: THREE.Mesh, colour: number, glow: number): void {
  const material = mesh.material as THREE.MeshLambertMaterial;
  material.color.setHex(colour);
  material.emissive.setHex(colour);
  material.emissiveIntensity = Math.max(0, glow);
}

function paintBasic(mesh: THREE.Mesh, colour: number, opacity: number): void {
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.color.setHex(colour);
  material.opacity = opacity;
}

// ---- The pads --------------------------------------------------------------

/**
 * A pad: the class outline at the target yaw, filled faintly so it reads from
 * above, with a notch on the load's own `+x` side showing which way it must be
 * turned (`specs/world.md`).
 */
function buildPad(
  cls: Parameters<typeof classDimensions>[0],
  pos: Vec3,
  yaw: number,
): THREE.Group {
  const [width, height, depth] = classDimensions(cls);
  const group = new THREE.Group();
  group.position.set(pos[0], pos[1] - height + 0.04, pos[2]);
  group.rotation.set(0, -yaw * DEG, 0);

  const flat = (
    w: number,
    d: number,
    x: number,
    z: number,
    opacity: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({
        color: PAD,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0, z);
    return mesh;
  };

  // The footprint, filled faintly so it reads from above and edged in a band
  // thick enough to read from across the yard — a WebGL line is one pixel
  // wide however far away it is, which is not enough for a target.
  group.add(flat(width, depth, 0, 0, 0.22));
  const band = 0.16;
  group.add(flat(width, band, 0, -depth / 2 + band / 2, 0.95));
  group.add(flat(width, band, 0, depth / 2 - band / 2, 0.95));
  group.add(flat(band, depth, -width / 2 + band / 2, 0, 0.95));
  group.add(flat(band, depth, width / 2 - band / 2, 0, 0.95));

  // The yaw mark: a chevron on the load's own `+x` side, so the pad shows not
  // only where the load goes but which way round it must be turned.
  const tip = width / 2 - 0.1;
  const notch = new THREE.BufferGeometry();
  notch.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [tip - 0.62, 0, -0.44, tip, 0, 0, tip - 0.62, 0, 0.44],
      3,
    ),
  );
  notch.computeVertexNormals();
  const chevron = new THREE.Mesh(
    notch,
    new THREE.MeshBasicMaterial({
      color: PAD,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  group.add(chevron);
  return group;
}

// ---- Teardown --------------------------------------------------------------

function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh>;
    if (mesh.geometry !== undefined) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else if (material !== undefined) material.dispose();
  });
}
