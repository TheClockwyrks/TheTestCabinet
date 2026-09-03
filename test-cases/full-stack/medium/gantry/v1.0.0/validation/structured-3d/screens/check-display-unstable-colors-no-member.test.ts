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
// HOW A MEMBER'S COLOUR IS READ, UNDER AN ENGINE. The colour every member is
// drawn in is read before the check and again after it, off the objects the world
// pass will draw; what is asserted is that not one of them moved. The check is a
// pure reading and changes no structure (specs/instrumentation.md), so the crane
// is the same crane on both readings and a member drawn differently afterwards
// was drawn differently BY the check.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue, fail } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type DrawnObject,
  type Harness,
  type Vec3,
} from "../harness";

/**
 * The four diagonals bracing the tower's vertical faces, which this point takes
 * away: without them each face is a free parallelogram and the tower solve is a
 * mechanism, while every other rule of `specs/structure.md` is still satisfied.
 */
const FLAT_TOWER: readonly DesignMember[] = MINIMAL_CRANE.members.filter(
  (member) => {
    const [a, b] = member;
    const vertical = a[1] !== b[1];
    const horizontal = a[0] !== b[0] || a[2] !== b[2];
    return !(vertical && horizontal && a[1] <= 2 && b[1] <= 2);
  },
);

const UNBRACED: CraneDesign = {
  ...MINIMAL_CRANE,
  members: FLAT_TOWER,
};

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with every one of its vertices and the base colour of the material it is drawn
// with. `engine/rendering.md` fixes that the pipeline collects every enabled,
// visible render component on every live actor and draws it, so any build of this
// case that draws a member draws it there.
//
// A MEMBER IS FOUND BY WHERE IT RUNS, never by a name a build gave it: the object
// this reads is the one drawn ALONG the segment joining the member's two nodes —
// every vertex within `OFF_LINE` of that line, reaching both ends and running
// past neither. The engineless project has to sample the composited page and turn
// the camera to tell the scene from the readouts in front of it; here the world
// pass IS the scene, so neither is needed.

/** A colour read off the picture, each channel 0-255. */
type Rgb = readonly [number, number, number];

/** How far apart two colours are, on the 0-441 (`sqrt(3) * 255`) scale. */
function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** How far a drawing may lie off the segment it is drawn along, in units. */
const OFF_LINE = 0.25;

/** Whether `object` is drawn along the segment `from`-`to`, and only there. */
function drawnAlong(object: DrawnObject, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dy, dz);
  if (span === 0) return false;
  const slack = OFF_LINE / span;
  let least = Infinity;
  let most = -Infinity;
  for (const point of object.points()) {
    const t =
      ((point.x - from.x) * dx +
        (point.y - from.y) * dy +
        (point.z - from.z) * dz) /
      (span * span);
    const on = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
    if (Math.hypot(point.x - on.x, point.y - on.y, point.z - on.z) > OFF_LINE) {
      return false;
    }
    least = Math.min(least, t);
    most = Math.max(most, t);
  }
  return (
    least !== Infinity &&
    least <= slack &&
    least >= -slack &&
    most >= 1 - slack &&
    most <= 1 + slack
  );
}

/** The colour the member between `from` and `to` is drawn in, or `null`. */
function memberColour(h: Harness, from: Vec3, to: Vec3): Rgb | null {
  for (const object of drawnObjects(h)) {
    if (!drawnAlong(object, from, to)) continue;
    const hex = object.color;
    if (hex === null || !/^#[0-9a-f]{6}$/i.test(hex)) continue;
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];
  }
  return null;
}

/** A design's member as two world positions. */
function endsOf(member: DesignMember): [Vec3, Vec3] {
  return [
    { x: member[0][0], y: member[0][1], z: member[0][2] },
    { x: member[1][0], y: member[1][1], z: member[1][2] },
  ];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What every member of the posed crane is drawn in right now. */
function colours(members: readonly DesignMember[]): (Rgb | null)[] {
  return members.map((member) => {
    const [from, to] = endsOf(member);
    return memberColour(h, from, to);
  });
}

it("leaves every member the colour it was when the check finds a mechanism", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, UNBRACED);
  await h.advance(1);

  const before = colours(UNBRACED.members);

  const found = await h.check();
  await h.press("KeyC");
  await h.advance(1);
  const after = colours(UNBRACED.members);
  await h.capture(
    "check-unstable-color",
    "The uncoloured members of a mechanism",
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

  for (const [index, was] of before.entries()) {
    const now = after[index]!;
    if (was === null || now === null) continue;
    if (apart(was, now) === 0) continue;
    fail(
      "the check to colour no member when the structure does not stand, so " +
        "every member is drawn in the colour it was (specs/ui.md § Build)",
      `member ${index} went from [${was.join(", ")}] to [${now.join(", ")}]`,
    );
  }
});
