// presentation/envelope-extent-visible — the build screen draws the envelope's
// extent as a visible aid, at the site's own ranges.
//
// specs/overview.md, "Visual design": "On the build screen, the buildable lattice
// and the envelope's extent are visible aids". specs/world.md, "The envelope":
// "Each site fixes a build envelope: an axis-aligned box, stated as inclusive
// coordinate ranges on each axis. Every lattice node used by the structure lies
// inside the envelope, so the envelope bounds where the crane may be built."
// specs/sites.md fixes those ranges site by site.
//
// TWO SITES, BECAUSE THE AID IS THE SITE'S RANGES AND NOT A DECORATION. Site
// three, Over the Wall, runs `x -10..12`; site four, Long Reach, runs `x -10..20`.
// So the same world position — the vertical line where `x = 12` meets `z = -8` —
// is the envelope's own corner on one site and ordinary space well inside it on
// the other. A build that drew a fixed box, or drew none at all, cannot answer
// both frames: the boundary has to be at `x = 12` on the first site and at
// `x = 20` on the second, and gone from `x = 12` there.
//
// THE POINTS ARE READ AT ODD HEIGHTS, which is the whole reason this reads a
// vertical corner and not the ground line. `LATTICE_PITCH` is `2`
// (specs/world.md), so a lattice node's coordinates are all even and a point at
// `y = 5` is on the envelope's corner and on no node — which keeps the lattice
// aid, the other half of the same sentence, out of the reading.
//
// THE CONTROL IS THE OTHER SITE, not a second place on this one. The same world
// position carries a boundary on the site whose envelope ends there and carries
// none on the site whose envelope runs past it, so a build that drew something
// along every vertical line, or nothing at all, fails one of the two halves.
//
// THE YARD IS EMPTIED on both sites and the pointer parked off every node, so
// nothing is built against the boundary, no obstacle or load stands near it, and
// no node is highlighted. The camera is left where opening a site puts it, so the
// two frames are the same view of two different envelopes.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Site three, `x -10..12`, and site four, `x -10..20` (specs/sites.md). */
const NEAR_SITE = 2;
const FAR_SITE = 3;

/** Where each site's envelope ends along `+x`. */
const NEAR_EDGE = 12;
const FAR_EDGE = 20;

/** The face both corners stand on: `z = -8`, shared by both envelopes. */
const FACE_Z = -8;

/** The heights read, all odd, so no lattice node lies on any of them. */
const HEIGHTS = [5, 7, 9, 11, 13, 15] as const;

/** How many of the six must carry the boundary on the site that has one. */
const NEEDED = 5;

/** How many may carry it on the site whose envelope reaches past it. */
const ALLOWED = 1;

/**
 * How far around a point the boundary is looked for, in world units.
 *
 * Small against the lattice pitch of `2`, so a lattice node a unit above or
 * below one of the odd heights read here is well outside it and only something
 * standing on the corner itself answers.
 */
const REACH = 0.3;

/** Where the pointer is parked: a stage corner, so no node is picked. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/* -------------------------------------------------------------------------- */
/* Reading the yard                                                           */
/* -------------------------------------------------------------------------- */
//
// THIS ENGINE'S HALF OF THIS POINT IS WHERE THE PICTURE IS READ. Under this
// engine the yard is the engine's own retained scene — "what `render` added on
// one frame is still there on the next… this is what lets a check find an object
// by name and read its world position with no pixels involved" (`rendering.ts`)
// — and this process has no GPU, so the yard has no pixels at all. An engineless
// build owns its own renderer, so its version of this point photographs the page
// and reads colours at projected stage points; here the same question is asked in
// WORLD units, of the bodies the build put in the scene.
//
// NOTHING IS FOUND BY NAME. What a build calls the objects it renders is its own;
// where it puts them is not.
//
// A BODY IS READ AT ITS OWN RESOLUTION, not at its bounding box's. A box is right
// for a solid, but an outline drawn as line segments and a cloud of points both
// have bounding boxes covering everything they enclose, and this point turns on
// whether something is drawn AT a place rather than around it. So a line is
// tested segment by segment and a cloud vertex by vertex.
//
// AND A BODY THAT SPANS THE YARD MARKS NO PLACE IN IT. The ground plane and the
// sky enclose every position there is, so a reading that counted them would
// answer "yes" everywhere and decide nothing. A solid is only counted when it is
// small enough to be about one place: at most `LOCAL` world units across, which
// is longer than the longest member a site allows and a small fraction of the
// hundreds of units a ground plane or a sky dome spans.

/** A solid reaching further than this across spans the yard, not one place. */
const LOCAL = 20;

/** Whether the yard shows anything within `radius` world units of `at`. */
function drawnAt(
  harness: Harness,
  at: { x: number; y: number; z: number },
  radius: number,
): boolean {
  const point = new THREE.Vector3(at.x, at.y, at.z);
  const first = new THREE.Vector3();
  const second = new THREE.Vector3();
  const segment = new THREE.Line3();
  const nearest = new THREE.Vector3();
  let found = false;

  harness.engine.scene.traverse((object) => {
    if (found) return;
    const drawn = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isLineSegments?: boolean;
      isPoints?: boolean;
    };
    if (
      drawn.isMesh !== true &&
      drawn.isLine !== true &&
      drawn.isPoints !== true
    ) {
      return;
    }
    // Hidden bodies fill nothing: a build is free to keep a pool and hide what
    // it is not using, and the engine's scene retains both.
    for (
      let node: THREE.Object3D | null = object;
      node !== null;
      node = node.parent
    ) {
      if (!node.visible) return;
    }
    object.updateWorldMatrix(true, false);

    if (drawn.isMesh === true) {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) > LOCAL) return;
      box.expandByScalar(radius);
      if (box.containsPoint(point)) found = true;
      return;
    }

    const geometry = (object as THREE.Points).geometry;
    const positions = geometry.getAttribute("position") as
      | THREE.BufferAttribute
      | undefined;
    if (positions === undefined) return;

    if (drawn.isPoints === true) {
      for (let index = 0; index < positions.count; index += 1) {
        first.fromBufferAttribute(positions, index).applyMatrix4(
          object.matrixWorld,
        );
        if (first.distanceTo(point) <= radius) {
          found = true;
          return;
        }
      }
      return;
    }

    // A line: `LineSegments` is disjoint pairs, a plain `Line` a polyline.
    const step = drawn.isLineSegments === true ? 2 : 1;
    for (let index = 0; index + 1 < positions.count; index += step) {
      first.fromBufferAttribute(positions, index).applyMatrix4(
        object.matrixWorld,
      );
      second.fromBufferAttribute(positions, index + 1).applyMatrix4(
        object.matrixWorld,
      );
      segment.set(first, second);
      segment.closestPointToPoint(point, true, nearest);
      if (nearest.distanceTo(point) <= radius) {
        found = true;
        return;
      }
    }
  });

  return found;
}

/** The heights at which a boundary stands on the corner at `x`. */
function boundaryAt(h: Harness, x: number): number[] {
  const carrying: number[] = [];
  for (const y of HEIGHTS) {
    if (drawnAt(h, { x, y, z: FACE_Z }, REACH)) carrying.push(y);
  }
  return carrying;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the envelope's boundary where the open site's ranges put it", async () => {
  await openSite(h, NEAR_SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const near = await h.snapshot();
  assertTrue(
    near.site.envelope.max.x === NEAR_EDGE,
    `site ${NEAR_SITE + 1} to run out to x ${NEAR_EDGE} (specs/sites.md)`,
  );
  await h.capture("envelope", "The envelope aid on two sites");

  const nearOwn = boundaryAt(h, NEAR_EDGE);
  const nearFar = boundaryAt(h, FAR_EDGE);

  await openSite(h, FAR_SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const far = await h.snapshot();
  assertTrue(
    far.site.envelope.max.x === FAR_EDGE,
    `site ${FAR_SITE + 1} to run out to x ${FAR_EDGE} (specs/sites.md)`,
  );
  const farOwn = boundaryAt(h, FAR_EDGE);
  const farNear = boundaryAt(h, NEAR_EDGE);

  assertGreaterThanOrEqual(
    nearOwn.length,
    NEEDED,
    `${NEEDED} of the ${HEIGHTS.length} heights on the corner where ` +
      `x = ${NEAR_EDGE} meets z = ${FACE_Z} to carry something, on the site ` +
      "whose envelope ends there, since the build screen draws the " +
      `envelope's extent as a visible aid (specs/overview.md); only ` +
      `${nearOwn.length} did`,
  );
  assertGreaterThanOrEqual(
    farOwn.length,
    NEEDED,
    `${NEEDED} of the ${HEIGHTS.length} heights on the corner where ` +
      `x = ${FAR_EDGE} meets z = ${FACE_Z} to carry it on the site whose ` +
      `envelope ends there (specs/overview.md); only ${farOwn.length} did`,
  );
  assertLessThanOrEqual(
    nearFar.length,
    ALLOWED,
    `nothing at x = ${FAR_EDGE} on the site whose envelope stops at ` +
      `${NEAR_EDGE}, since the aid is drawn at the site's own ranges ` +
      `(specs/world.md); ${nearFar.length} of the ${HEIGHTS.length} heights ` +
      `carried a boundary there (y ${nearFar.join(", ")})`,
  );
  assertLessThanOrEqual(
    farNear.length,
    ALLOWED,
    `nothing at x = ${NEAR_EDGE} any more on the site whose envelope reaches ` +
      `${FAR_EDGE}, since the aid follows the site's ranges (specs/world.md); ` +
      `${farNear.length} of the ${HEIGHTS.length} heights still carried a ` +
      `boundary there (y ${farNear.join(", ")})`,
  );
});
