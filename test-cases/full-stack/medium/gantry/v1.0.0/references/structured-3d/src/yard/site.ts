// The site, and the aids that make it buildable.
//
// The fixtures are what a player must be able to read before anything is built
// (`specs/overview.md`): the envelope's extent, the anchors, the obstacles, and
// each pad's footprint at its required yaw. They change only when the open site
// does, so they are rebuilt on a signature rather than every frame.
//
// The aids are the build screen's own: the lattice as a field of points, the
// node under the pointer, and the node being held. All three are drawn over the
// crane rather than through it, so a held node is never lost inside the
// structure standing around it.

import * as THREE from "three";
import { Object3DComponent } from "@test-cabinet/structured-3d";
import { LAYER } from "../layers";
import {
  ANCHOR_PLATE,
  ENVELOPE,
  LATTICE,
  OBSTACLE,
  OBSTACLE_EDGE,
  PAD,
  PENDING_NODE,
  PICK_NODE,
} from "../palette";
import { latticeNodes, type DrawnPad, type YardPosture } from "../posture";
import { classDimensions, DEG, nodeKey, type Vec3 as SimVec3 } from "../sim";
import { triple } from "../adapt";
import { GantryView, type ViewFrame } from "../actor-view";
import { boxOf, disposeTree, paintBasic, Pool } from "./three-kit";

/** A cheap identity for the fixtures, so they are rebuilt only when posed. */
export function fixtureSignature(posture: YardPosture): string {
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

/**
 * A pad: the class outline at the target yaw, filled faintly so it reads from
 * above, with a notch on the load's own `+x` side showing which way it must be
 * turned (`specs/world.md`).
 */
export function buildPad(pad: DrawnPad): THREE.Group {
  const [width, height, depth] = classDimensions(pad.cls);
  const group = new THREE.Group();
  group.name = `pad-${pad.cls}`;
  group.position.set(pad.pos[0], pad.pos[1] - height + 0.04, pad.pos[2]);
  group.rotation.set(0, -pad.yaw * DEG, 0);

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
  // thick enough to read from across the yard — a WebGL line is one pixel wide
  // however far away it is, which is not enough for a target.
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
  group.add(
    new THREE.Mesh(
      notch,
      new THREE.MeshBasicMaterial({
        color: PAD,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  return group;
}

/** The lattice, as a field of points on the nodes a click may take. */
function latticeField(nodes: readonly SimVec3[]): THREE.Points {
  const positions = new Float32Array(nodes.length * 3);
  nodes.forEach((node, i) => {
    positions[i * 3] = node[0];
    positions[i * 3 + 1] = node[1];
    positions[i * 3 + 2] = node[2];
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const field = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: LATTICE,
      size: 0.3,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  );
  field.name = "lattice";
  return field;
}

export class SiteActor extends GantryView {
  private readonly fixtures = new THREE.Group();
  private readonly aids = new THREE.Group();
  private readonly markerGeometry = new THREE.OctahedronGeometry(0.42);
  private readonly markers: Pool<THREE.Mesh>;
  private lattice: THREE.Points | null = null;
  private signature = "";

  constructor() {
    super();
    this.fixtures.name = "fixtures";
    this.aids.name = "aids";

    const fixtures = this.attach(
      new Object3DComponent({ object: this.fixtures }),
    );
    fixtures.layer = LAYER.fixtures;

    const aids = this.attach(new Object3DComponent({ object: this.aids }));
    aids.layer = LAYER.aids;

    this.markers = new Pool(this.aids, () => this.makeMarker());
  }

  override refresh(frame: ViewFrame): void {
    const { posture, state } = frame;
    const signature = fixtureSignature(posture);
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(posture);
    }

    // The lattice is the build screen's aid; the program screen keeps it up so
    // the yard reads the same on both.
    const build = state.screen === "build";
    if (this.lattice !== null) {
      this.lattice.visible = build || state.screen === "program";
    }

    this.markers.begin();
    const picked = build ? frame.pick.node : null;
    if (picked !== null) {
      const marker = this.markers.take();
      const at = triple(picked);
      marker.position.set(at[0], at[1], at[2]);
      marker.scale.setScalar(1.15 + 0.12 * Math.sin(state.simTime * 6));
      paintBasic(marker, PICK_NODE, 0.95);
    }
    const pending = build ? state.pendingNode : null;
    if (pending !== null) {
      // The held node is marked bigger and in the accent, so a player never
      // mistakes it for the node the pointer happens to be over.
      const marker = this.markers.take();
      marker.position.set(pending.x, pending.y, pending.z);
      marker.scale.setScalar(1.75);
      paintBasic(marker, PENDING_NODE, 1);
    }
    this.markers.end();
  }

  override endPlay(): void {
    disposeTree(this.fixtures);
    disposeTree(this.aids);
    this.markerGeometry.dispose();
  }

  private makeMarker(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.markerGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        // A marker is an aid rather than a body: it is drawn over everything,
        // so the node under the pointer and the node being held are visible
        // even where the crane already stands around them.
        depthTest: false,
      }),
    );
    mesh.renderOrder = 6;
    mesh.name = "marker";
    return mesh;
  }

  /** Build the open site's fixtures and its lattice field afresh. */
  private rebuild(posture: YardPosture): void {
    for (const child of [...this.fixtures.children]) {
      this.fixtures.remove(child);
      disposeTree(child);
    }
    if (this.lattice !== null) {
      this.aids.remove(this.lattice);
      disposeTree(this.lattice);
      this.lattice = null;
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
    outline.name = "envelope";
    outline.position.set(
      envelope.centre[0],
      envelope.centre[1],
      envelope.centre[2],
    );
    this.fixtures.add(outline);

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
      plate.name = "anchor";
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
      mesh.name = "obstacle";
      mesh.position.set(centre[0], centre[1], centre[2]);
      this.fixtures.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: OBSTACLE_EDGE }),
      );
      edges.position.set(centre[0], centre[1], centre[2]);
      this.fixtures.add(edges);
    }

    // The pads: each load's footprint at its required yaw, with a yaw mark.
    for (const pad of posture.pads) this.fixtures.add(buildPad(pad));

    this.lattice = latticeField(latticeNodes(posture.envelope));
    this.aids.add(this.lattice);
  }
}
