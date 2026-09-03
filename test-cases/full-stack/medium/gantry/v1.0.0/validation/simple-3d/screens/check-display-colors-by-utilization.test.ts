// screens/check-display-colors-by-utilization — the check colours each member by
// its static utilization, so two members carrying different utilizations are
// drawn differently.
//
// specs/ui.md § Build, the check's table: with "No readiness issue, and the
// structure stands" the screen shows "the issues by name ... that the structure
// stands, and each member colored by its static utilization on the utilization
// ramp (specs/overview.md)". specs/overview.md § Visual design fixes what the
// ramp is: "each member's color reads its utilization on a monotone ramp from
// slack to its limit". A ramp that is monotone in utilization draws two members
// carrying visibly different utilizations in visibly different colours; which
// colours those are is the build's.
//
// THE PAIR IS CHOSEN SO THAT NOTHING BUT UTILIZATION SEPARATES THEM. Members 1
// and 2 of the minimal crane are the tower legs at `(2, 0, 0)-(2, 2, 0)` and
// `(0, 0, 2)-(0, 2, 2)`: the same material, the same length, and both vertical, so
// a build that drew them alike before the check has only the ramp to tell them
// apart afterwards. A counterweight hung at the rail tip is what puts the
// utilizations apart — the leg under the load carries several times what the leg
// across the tower does — and the check's own report of the two is read first,
// because the ramp can only be held to the figures the game itself says it is
// colouring.
//
// HOW A MEMBER'S COLOUR IS READ, AND THIS IS THIS ENGINE'S HALF OF THE POINT.
// The yard is a 3D scene, and under this engine the scene is the engine's own
// retained one: "what `render` added on one frame is still there on the next…
// this is what lets a check find an object by name and read its world position
// with no pixels involved" (`rendering.ts`). This process has no GPU, so there
// are no pixels to read; there is the scene, and it is the better reading anyway
// — an engineless build's version of this point has to turn the camera to tell a
// member from a readout standing in front of it, and here the two are different
// surfaces by construction.
//
// THE MEMBER IS FOUND BY ITS GEOMETRY AND NEVER BY A NAME. What a build calls the
// objects it renders is its own; where it puts them is not. A member drawn
// between two nodes is whatever the build rendered that spans exactly that
// segment — one object whose world bounding box is centred on the segment's
// midpoint and whose diagonal is the segment's own length, give or take the
// thickness a member is drawn with. Nothing here reads a colour VALUE: the
// palette is the build's, and what this point is about is that the two are
// different.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import {
  MINIMAL_CRANE,
  createHarness,
  openSite,
  standMinimalCrane,
  type DesignMember,
  type Harness,
} from "../harness";

/** The two tower legs: same material, same length, both vertical. */
const LEGS = [1, 2] as const;

/** The node the counterweight hangs on: the rail tip of the minimal crane. */
const WEIGHT = { x: 4, y: 4, z: 0 } as const;

/** How far apart the two legs' utilizations must stand for the ramp to read. */
const SPREAD = 0.2;

/** How far apart two colours must be to be different colours to a player. */
const DIFFERENT = 24;

/** How far an object's centre may sit from a member's midpoint, world units. */
const CENTRED = 0.25;

/** How much longer than the member its drawn body may be, world units. */
const THICKNESS = 1;

/** A colour as a player reads it: three channels, `0`–`255`. */
type Rgb = [number, number, number];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** How far two colours stand apart. */
function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

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
 * The body is taken as its material's `color`, blended with its `emissive`: a
 * build is free to carry the ramp on either, and a member that reads as one
 * colour to a player reads as that pair here.
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
    found = [
      Math.round((one[0] + two[0]) / (base && glow ? 2 : 1)),
      Math.round((one[1] + two[1]) / (base && glow ? 2 : 1)),
      Math.round((one[2] + two[2]) / (base && glow ? 2 : 1)),
    ];
  });
  return found;
}

it("draws two members of different utilization in different colours", async () => {
  await openSite(h, 0);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await standMinimalCrane(h);
  await h.debug.addCounterweight(WEIGHT.x, WEIGHT.y, WEIGHT.z);

  const found = await h.check();
  await h.press("KeyC");
  await h.advance(1);
  await h.capture("check-colors", "The members coloured by utilization");

  assertTrue(
    found.stable,
    "the crane to stand, so the check colours its members at all " +
      "(specs/ui.md § Build)",
  );
  const utilizations = LEGS.map((id) => {
    const member = found.members.find((one) => one.id === id);
    if (member === undefined) {
      fail(
        `the check to report member ${id}, one of the two tower legs this ` +
          "check reads the ramp across (specs/structure.md § The static check)",
        `it reported ${JSON.stringify(found.members.map((one) => one.id))}`,
      );
    }
    return member.utilization;
  });
  assertGreaterThan(
    Math.abs(utilizations[0]! - utilizations[1]!),
    SPREAD,
    "the gap between the two legs' utilizations, which is what the ramp has " +
      "to read as a difference in colour (specs/overview.md § Visual design)",
  );

  const colors = LEGS.map((id) => {
    const color = memberColor(h, MINIMAL_CRANE.members[id]!);
    if (color === null) {
      fail(
        `member ${id} to be drawn as a body spanning the two nodes it runs ` +
          "between, so the colour the check gave it can be read " +
          "(specs/ui.md § Build)",
        "the scene holds nothing centred on that segment's midpoint whose " +
          "extent is the segment's own length",
      );
    }
    return color;
  });

  if (apart(colors[0]!, colors[1]!) < DIFFERENT) {
    fail(
      "two members carrying different utilizations to be drawn in different " +
        "colours, as a monotone ramp from slack to the limit draws them " +
        "(specs/ui.md § Build, specs/overview.md § Visual design)",
      `member ${LEGS[0]} at utilization ${utilizations[0]!.toFixed(3)} and ` +
        `member ${LEGS[1]} at ${utilizations[1]!.toFixed(3)} are both drawn ` +
        `[${colors[0]!.join(", ")}] and [${colors[1]!.join(", ")}], ` +
        `${apart(colors[0]!, colors[1]!).toFixed(1)} apart`,
    );
  }
});
