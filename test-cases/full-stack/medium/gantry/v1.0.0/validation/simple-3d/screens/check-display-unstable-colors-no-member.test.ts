// screens/check-display-unstable-colors-no-member — a structure that does not
// stand has no member coloured.
//
// specs/ui.md § Build, the check's table: with "No readiness issue, and the
// structure does not stand" the screen shows "The issues by name, `empty-program`
// among them when the tape is empty, and that the structure does not stand; the
// check reports no member, so nothing is colored". specs/structure.md § The
// static check: "A structure that is not solved does not stand ... and it reports
// no member at all: the member list is empty exactly when the structure does not
// stand."
//
// The crane is the minimal one with the four diagonals bracing the tower's sides
// taken away and nothing else changed: it keeps its ring, its sound single-rail
// track and a member path to an anchor or a flange node from every member, so it
// raises no readiness issue, while each of the tower's four vertical faces is left
// a free parallelogram, so the tower solve cannot be regular. That is the row of
// the table this point is about — ready, not standing, and nothing coloured — and
// the readiness is read first, because a crane that raised an issue would be the
// row above it instead.
//
// HOW A MEMBER'S COLOUR IS READ, AND THIS IS THIS ENGINE'S HALF OF THE POINT.
// The yard is a 3D scene, and under this engine the scene is the engine's own
// retained one: "what `render` added on one frame is still there on the next…
// this is what lets a check find an object by name and read its world position
// with no pixels involved" (`rendering.ts`). This process has no GPU, so there
// are no pixels to read; there is the scene, and it is the better reading anyway
// — an engineless build's version of this point has to turn the camera to tell a
// member from a readout standing in front of it, and here the two are different
// surfaces by construction. Nothing here reads a colour VALUE: the palette is the
// build's, and what this point is about is that the check left every member
// exactly as it drew it.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThan, assertLength, assertTrue, fail } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
} from "../harness";

/** Fewer members found in the scene than this and the crane was never drawn. */
const ENOUGH = 12;

/** How far an object's centre may sit from a member's midpoint, world units. */
const CENTRED = 0.25;

/** How much longer than the member its drawn body may be, world units. */
const THICKNESS = 1;

/** A colour as a player reads it: three channels, `0`–`255`. */
type Rgb = [number, number, number];

/** A three colour as the three channels a player reads. */
function rgbOf(color: THREE.Color): Rgb {
  const hex = color.getHexString();
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * The colour the build drew a member in, or `null` when nothing spans it.
 *
 * THE MEMBER IS FOUND BY ITS GEOMETRY AND NEVER BY A NAME. What a build calls the
 * objects it renders is its own; where it puts them is not. A member drawn
 * between two nodes is whatever the build rendered that spans exactly that
 * segment — one object whose world bounding box is centred on the segment's
 * midpoint and whose diagonal is the segment's own length, give or take the
 * thickness a member is drawn with.
 *
 * The colour is its material's `color` blended with its `emissive`: a build is
 * free to carry the ramp on either, and a member that reads as one colour to a
 * player reads as that pair here.
 */
function memberColor(harness: Harness, member: DesignMember): Rgb | null {
  const [a, b] = member;
  const from = new THREE.Vector3(a[0], a[1], a[2]);
  const to = new THREE.Vector3(b[0], b[1], b[2]);
  const midpoint = from.clone().add(to).multiplyScalar(0.5);
  const length = from.distanceTo(to);

  let found: Rgb | null = null;
  harness.engine.scene.traverse((object) => {
    if (found !== null) return;
    if (!(object as unknown as { isMesh?: boolean }).isMesh) return;
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    if (centre.distanceTo(midpoint) > CENTRED) return;
    const diagonal = box.getSize(new THREE.Vector3()).length();
    if (diagonal < length || diagonal > length + THICKNESS) return;
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial>;
    const base = material.color === undefined ? null : rgbOf(material.color);
    const glow =
      material.emissive === undefined ? null : rgbOf(material.emissive);
    if (base === null && glow === null) return;
    const one = base ?? [0, 0, 0];
    const two = glow ?? [0, 0, 0];
    const parts = base !== null && glow !== null ? 2 : 1;
    found = [
      Math.round((one[0] + two[0]) / parts),
      Math.round((one[1] + two[1]) / parts),
      Math.round((one[2] + two[2]) / parts),
    ];
  });
  return found;
}

/** Every member's drawn colour, in the design's own order. */
function memberColors(
  harness: Harness,
  members: readonly DesignMember[],
): (Rgb | null)[] {
  return members.map((member) => memberColor(harness, member));
}

/**
 * The minimal crane's tower with no out-of-plane bracing: the four legs, the
 * bottom flange square and the one diagonal across it, and none of the four
 * diagonals that brace the tower's sides.
 */
const FLAT_TOWER: readonly DesignMember[] = [
  [[0, 0, 0], [0, 2, 0], "strut"],
  [[2, 0, 0], [2, 2, 0], "strut"],
  [[0, 0, 2], [0, 2, 2], "strut"],
  [[2, 0, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [2, 2, 0], "strut"],
  [[0, 2, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [0, 2, 2], "strut"],
  [[2, 2, 0], [2, 2, 2], "strut"],
  [[0, 2, 0], [2, 2, 2], "strut"],
];

/** The minimal crane's arm: every member of it stands at or above `y = 4`. */
const ARM: readonly DesignMember[] = MINIMAL_CRANE.members.filter(
  ([a, b]) => a[1] >= 4 && b[1] >= 4,
);

/** Ready, sound member by member, and a mechanism below the ring. */
const UNBRACED: CraneDesign = {
  site: 0,
  name: "Unbraced tower",
  ring: [0, 2, 0],
  counterweights: [],
  members: [...FLAT_TOWER, ...ARM],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every member the colour it was when the check finds a mechanism", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, UNBRACED);
  await h.advance(1);

  const before = memberColors(h, UNBRACED.members);

  const found = await h.check();
  await h.press("KeyC");
  await h.advance(1);
  const after = memberColors(h, UNBRACED.members);
  await h.capture(
    "check-unstable-color",
    "The members left uncolored of a mechanism",
  );

  assertLength(
    found.issues.filter((issue) => issue !== "empty-program"),
    0,
    "the readiness issues of the unbraced crane, so the screen is showing " +
      "the row of the check's table a READY structure reaches (specs/ui.md " +
      "§ Build)",
  );
  assertTrue(
    found.stable === false,
    "the unbraced crane not to stand, so the check reports no member " +
      "(specs/structure.md § The static check)",
  );

  const drawn = before.filter((color) => color !== null);
  assertGreaterThan(
    drawn.length,
    ENOUGH,
    "the crane's members found drawn in the yard, which is what a colour can " +
      "be read off (specs/overview.md § Visual design)",
  );

  const colored = UNBRACED.members.flatMap((_member, index) => {
    const was = before[index];
    const now = after[index];
    if (was === undefined || was === null || now === undefined) return [];
    if (now !== null && was.join() === now.join()) return [];
    return [index];
  });
  if (colored.length > 0) {
    const index = colored[0]!;
    fail(
      "the check to colour no member when the structure does not stand, so " +
        "every member is drawn in the colour it was (specs/ui.md § Build)",
      `${colored.length} of ${drawn.length} drawn members changed: member ` +
        `${index} went from [${(before[index] as Rgb).join(", ")}] to ` +
        `[${after[index] === null ? "nothing drawn" : (after[index] as Rgb).join(", ")}]`,
    );
  }
});
