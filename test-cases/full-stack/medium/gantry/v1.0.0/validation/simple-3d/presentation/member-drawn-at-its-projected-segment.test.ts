// presentation/member-drawn-at-its-projected-segment — a placed member is drawn
// along the segment joining its two nodes.
//
// specs/ui.md, "Build": `build` "shows the yard through the camera: the ground,
// the lattice and envelope aids, the anchors, the obstacles, the loads at their
// starting poses, the pads, and the structure as built". specs/overview.md,
// "Hard requirements": "Render a real 3D scene on the canvas: the yard, the
// lattice aids, the crane's members and parts, the loads, and the readouts".
// specs/assets.md, "What is drawn in code": the members are "each as real drawn
// geometry".
//
// SO THE PICTURE IS THE STRUCTURE IN THE WORLD. A member runs between two
// lattice nodes (specs/structure.md), so drawing it is drawing something along
// the segment joining those two nodes — which under this engine is read in the
// world units the segment is stated in rather than at the stage points a camera
// puts them at.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws a strut AS is
// entirely its own: a box beam, a tube, a pair of rails. What is fixed is that
// placing one changes the yard, and that the change lies along the segment and
// not somewhere else. So the yard is emptied to nothing, the yard is read, the
// one member is posed with the camera and the pointer untouched, and the yard is
// read again.
//
// THE FLANKS ARE THE OTHER HALF OF THE ASSERTION. A build that answered the
// first half alone could be redrawing the whole yard; the two lines parallel to
// the segment, `FLANK` world units to either side of it, are what says the change
// is the member and is where the member is. `FLANK` is far wider than any member
// is drawn — a member joins nodes a lattice pitch of `2` apart and is a slender
// thing beside that — and the member stands alone in the yard, so nothing else is
// expected there.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The member: one vertical strut, out along `+x`, clear of everything else. */
const FROM = { x: 8, y: 4, z: 0 } as const;
const TO = { x: 8, y: 10, z: 0 } as const;

/** How many points are read along the segment. */
const SAMPLES = 10;

/** How many of them a member drawn along the segment must reach. */
const NEEDED = 8;

/** How far to either side of the segment the yard must stand unchanged. */
const FLANK = 1.5;

/** How near a point a body must come to count as drawn there, in world units. */
const REACH = 0.3;

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
// WORLD units, of the bodies the build put in the scene. That is the stronger
// reading of the two: a body drawn in the right part of the picture but in the
// wrong place in the world passes there and fails here.
//
// NOTHING IS FOUND BY NAME. What a build calls the objects it renders is its own;
// where it puts them is not.

/** One body the yard is drawn from, and where it stands in the world. */
interface Body {
  /** Everything about it a redraw would have to keep to be the same body. */
  signature: string;
  box: THREE.Box3;
}

/**
 * Every body the yard is drawn from, with its world extent.
 *
 * A body is anything the build put in the scene that occupies space — a mesh, a
 * line, a cloud of points. Lights and bare groups occupy none and are skipped:
 * they carry no extent for a reading about a place to be about.
 */
function bodies(harness: Harness): Body[] {
  const found: Body[] = [];
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
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial> | undefined;
    found.push({
      signature: [
        object.type,
        object.visible ? "1" : "0",
        box.min.toArray().map((one) => one.toFixed(3)).join(),
        box.max.toArray().map((one) => one.toFixed(3)).join(),
        material?.color?.getHexString() ?? "",
        material?.emissive?.getHexString() ?? "",
        material?.opacity ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Every body one reading holds that the other does not, either way round. */
function changedBodies(
  before: readonly Body[],
  after: readonly Body[],
): Body[] {
  const tally = (read: readonly Body[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const body of read) {
      counts.set(body.signature, (counts.get(body.signature) ?? 0) + 1);
    }
    return counts;
  };
  const was = tally(before);
  const now = tally(after);
  return [
    ...after.filter(
      (body) => (now.get(body.signature) ?? 0) > (was.get(body.signature) ?? 0),
    ),
    ...before.filter(
      (body) => (now.get(body.signature) ?? 0) < (was.get(body.signature) ?? 0),
    ),
  ];
}

/** How many of `changed` reach within `radius` world units of `at`. */
function changedNear(
  changed: readonly Body[],
  at: { x: number; y: number; z: number },
  radius: number,
): number {
  const ball = new THREE.Sphere(new THREE.Vector3(at.x, at.y, at.z), radius);
  return changed.filter((body) => body.box.intersectsSphere(ball)).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a placed member along the segment between its two nodes", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const from = new THREE.Vector3(FROM.x, FROM.y, FROM.z);
  const to = new THREE.Vector3(TO.x, TO.y, TO.z);
  const span = from.distanceTo(to);
  assertGreaterThanOrEqual(
    span,
    2 * REACH,
    "the segment to be long enough to read along, which this member is",
  );

  // Two directions across the segment: where the flanks are. The member runs
  // along `+y`, so `+x` and `+z` are both square to it.
  const along = to.clone().sub(from).normalize();
  const across = new THREE.Vector3(1, 0, 0);
  if (Math.abs(across.dot(along)) > 0.9) across.set(0, 0, 1);
  const other = new THREE.Vector3().crossVectors(along, across).normalize();
  across.crossVectors(other, along).normalize();

  const onSegment = Array.from({ length: SAMPLES }, (_unused, index) => {
    const t = (index + 0.5) / SAMPLES;
    return from.clone().lerp(to, t);
  });
  const flanks = onSegment.flatMap((point) => [
    { at: point.clone().addScaledVector(across, FLANK), side: "one side" },
    {
      at: point.clone().addScaledVector(across, -FLANK),
      side: "the other side",
    },
    { at: point.clone().addScaledVector(other, FLANK), side: "a third side" },
    { at: point.clone().addScaledVector(other, -FLANK), side: "the fourth" },
  ]);

  const empty = bodies(h);

  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");
  await h.advance(1);
  assertTrue(
    (await h.snapshot()).structure.members.length === 1,
    "the one member this point poses to stand (specs/structure.md)",
  );

  const built = bodies(h);
  const changed = changedBodies(empty, built);
  await h.capture("member", "The member drawn between its two nodes");

  const drawn = onSegment.filter(
    (point) => changedNear(changed, point, REACH) > 0,
  ).length;
  assertGreaterThanOrEqual(
    drawn,
    NEEDED,
    `${NEEDED} of the ${SAMPLES} points read along the segment joining ` +
      `(${FROM.x}, ${FROM.y}, ${FROM.z}) and (${TO.x}, ${TO.y}, ${TO.z}) to ` +
      "be drawn at when the member is placed, since the structure is drawn " +
      "as built in the yard (specs/ui.md)",
  );

  const spilled = flanks.filter(
    ({ at }) => changedNear(changed, at, REACH) > 0,
  );
  assertLessThanOrEqual(
    spilled.length,
    0,
    `the yard ${FLANK} world units to either side of the segment to stand ` +
      "unchanged, since a member is drawn along the segment between its " +
      "nodes and nowhere else (specs/ui.md); it changed at " +
      `${spilled
        .map(
          ({ at, side }) =>
            `(${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)}) on ` +
            side,
        )
        .join(", ")}`,
  );
});
