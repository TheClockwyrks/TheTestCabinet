// presentation/anchors-marked — a site's anchor nodes are marked in the yard,
// distinctly from the ordinary lattice around them.
//
// specs/overview.md, "Visual design", the row for anchors and pads: "Anchor
// points, each load's starting position, and each pad's footprint and required
// yaw are marked so a site is readable before anything is built."
// specs/world.md, "Anchors": each site fixes "lattice nodes on the ground where
// the structure is fixed to the earth", and specs/ui.md's `build` screen "shows
// the yard through the camera: the ground, the lattice and envelope aids, the
// anchors, ...".
//
// SO AN ANCHOR IS NOT JUST ANOTHER LATTICE NODE ON SCREEN. An anchor IS a lattice
// node, so a build that only drew the lattice would put the same mark on it as on
// the node beside it and the player could not read where the crane is fixed to
// the earth before building. The reading is therefore an anchor against an
// ordinary ground lattice node inside the same envelope: what the site says is
// different has to be drawn differently.
//
// WHAT IS COMPARED IS WHAT IS DRAWN AT THE NODE, NOT HUE. specs/overview.md
// leaves the palette to the build, so nothing here holds a reading against a
// colour; what it compares is the whole of what the yard puts at an anchor
// against the whole of what it puts at an ordinary node. A mark a player reads at
// a glance is something drawn there — a plate, a collar, a fixture, or the
// lattice's own point drawn larger or in another colour — and any of those parts
// the two readings.
//
// SITE SIX IS THE ONE READ, because its nine anchors over `(0..4, 0, 0..4)`
// (specs/sites.md) are the largest set the game has, so the point is decided over
// nine independent marks rather than four. `(10, 0, 0)` is the ordinary node they
// are read against: inside site six's envelope (`x -10..18`), on the ground, on
// the lattice, and not an anchor.
//
// THE YARD IS EMPTIED and the pointer parked off every node, so nothing is built
// over the anchors, no load or obstacle stands on one, and no node is highlighted.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThanOrEqual, assertNull } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** Site six, Heavy Haul, whose nine anchors run over `(0..4, 0, 0..4)`. */
const SITE = 5;

/** The ordinary ground lattice node the anchors are read against. */
const PLAIN: Vec3 = { x: 10, y: 0, z: 0 };

/** How many of the nine must read apart from it. */
const NEEDED = 8;

/** Where the pointer is parked: a stage corner, so no node is picked. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/* -------------------------------------------------------------------------- */
/* Reading the yard                                                           */
/* -------------------------------------------------------------------------- */
//
// THIS ENGINE'S HALF OF EVERY PRESENTATION POINT IS WHERE THE PICTURE IS READ.
// Under this engine the yard is the engine's own retained scene — "what `render`
// added on one frame is still there on the next… this is what lets a check find
// an object by name and read its world position with no pixels involved"
// (`rendering.ts`) — and this process has no GPU, so the yard has no pixels at
// all. An engineless build owns its own renderer, so its version of these points
// photographs the page and reads colours at projected stage points; here the
// same question is asked in WORLD units, of the bodies the build put in the
// scene. That is the stronger reading of the two: a mark drawn in the right part
// of the picture but in the wrong place in the world passes there and fails here.
//
// NOTHING IS FOUND BY NAME. What a build calls the objects it renders is its own;
// where it puts them is not.

/** How far from a point a mark on it may stand, in world units. */
const NEAR = 0.6;

/** A body reaching further than this across spans the yard, not one node. */
const LOCAL = 3;

/**
 * Everything the yard draws AT a world point, as a sorted list of descriptions.
 *
 * A MARK ON A POINT IS SOMETHING DRAWN AT IT. The ground, the sky, the envelope
 * outline and the survey grid all pass within `NEAR` of every point in the yard
 * and mark none of them, so a body is only counted when it is small enough to be
 * about one place: at most `LOCAL` world units across, which is more than a
 * lattice pitch and far less than anything that spans a site.
 *
 * A CLOUD OF POINTS IS COUNTED VERTEX BY VERTEX, because the lattice aid is one
 * object covering the whole envelope and a build is free to mark a node by
 * drawing its own point differently — bigger, or in another colour — rather than
 * by adding a body beside it. So a cloud contributes the vertices it puts inside
 * the ball, with the colour it gives each one.
 *
 * Every description is RELATIVE to the point asked about and rounded, so two
 * points can be compared for what is drawn at them rather than for where they
 * are.
 */
function marksAt(harness: Harness, at: Vec3): string[] {
  const centre = new THREE.Vector3(at.x, at.y, at.z);
  const ball = new THREE.Sphere(centre, NEAR);
  const found: string[] = [];
  const vertex = new THREE.Vector3();

  harness.engine.scene.traverse((object) => {
    const drawn = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isPoints?: boolean;
    };
    if (
      drawn.isMesh !== true &&
      drawn.isLine !== true &&
      drawn.isPoints !== true
    ) {
      return;
    }
    if (!object.visible) return;
    object.updateWorldMatrix(true, false);
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.PointsMaterial> | undefined;

    if (drawn.isPoints === true) {
      const geometry = (object as THREE.Points).geometry;
      const positions = geometry.getAttribute("position") as
        | THREE.BufferAttribute
        | undefined;
      if (positions === undefined) return;
      const colors = geometry.getAttribute("color") as
        | THREE.BufferAttribute
        | undefined;
      const inside: string[] = [];
      for (let index = 0; index < positions.count; index += 1) {
        vertex.fromBufferAttribute(positions, index);
        vertex.applyMatrix4(object.matrixWorld);
        if (vertex.distanceTo(centre) > NEAR) continue;
        const tint =
          colors === undefined
            ? ""
            : [
                colors.getX(index),
                colors.getY(index),
                colors.getZ(index),
              ]
                .map((one) => one.toFixed(3))
                .join();
        inside.push(
          `${vertex.clone().sub(centre).toArray().map((one) => one.toFixed(2)).join()}:${tint}`,
        );
      }
      if (inside.length === 0) return;
      found.push(
        `points|${material?.size ?? ""}|${material?.color?.getHexString() ?? ""}|` +
          `${material?.opacity ?? ""}|${inside.sort().join(";")}`,
      );
      return;
    }

    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty() || !box.intersectsSphere(ball)) return;
    const size = box.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) > LOCAL) return;
    const relative = box.getCenter(new THREE.Vector3()).sub(centre);
    found.push(
      [
        object.type,
        size.toArray().map((one) => one.toFixed(2)).join(),
        relative.toArray().map((one) => one.toFixed(2)).join(),
        (material as Partial<THREE.MeshStandardMaterial> | undefined)?.color?.getHexString() ?? "",
        material?.opacity ?? "",
        (object as THREE.Mesh).geometry?.type ?? "",
      ].join("|"),
    );
  });
  return found.sort();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks every anchor apart from the ordinary lattice around it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const posed = await h.snapshot();
  assertNull(
    posed.pick.node,
    "no node picked under the parked pointer, so nothing read here is the " +
      "picked node's highlight (specs/controls.md)",
  );
  const anchors = posed.site.anchors;
  assertGreaterThanOrEqual(
    anchors.length,
    9,
    `the nine anchors specs/sites.md gives ${posed.site.name}`,
  );

  await h.capture("anchors", "The nine anchors marked in the yard");

  const ordinary = marksAt(h, PLAIN).join("\n");
  const unmarked: string[] = [];
  for (const anchor of anchors) {
    if (marksAt(h, anchor).join("\n") === ordinary) {
      unmarked.push(`(${anchor.x}, ${anchor.y}, ${anchor.z})`);
    }
  }

  assertGreaterThanOrEqual(
    anchors.length - unmarked.length,
    NEEDED,
    `${NEEDED} of the ${anchors.length} anchors to carry something the ` +
      `ordinary ground lattice node (${PLAIN.x}, ${PLAIN.y}, ${PLAIN.z}) does ` +
      "not, since anchor points are marked so a site is readable before " +
      `anything is built (specs/overview.md). That node carries ` +
      `[${ordinary.replace(/\n/g, " | ")}]; nothing set apart ` +
      `${unmarked.join(", ")}`,
  );
});
