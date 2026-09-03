// screens/check-display-readiness-colors-no-member — with a readiness issue the
// check colors no member.
//
// specs/ui.md § Build, the check's table: with "A readiness issue" the screen
// shows "The issues by name, and no verdict: with a readiness issue the structure
// is not solved, and the check reports no member, so nothing is colored".
// specs/structure.md § The static check: "With any readiness issue the structure
// is not solved ... and it reports no member at all".
//
// The scenario is the minimal crane that stands with its ring taken away, which
// is the one edit that "is always allowed" (specs/structure.md) and leaves every
// member standing: the crane on screen is the same crane, member for member,
// before and after the check, so any member drawn differently afterwards was
// drawn differently by the check.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, fail } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  standMinimalCrane,
  type DesignMember,
  type DrawnObject,
  type Harness,
  type Vec3,
} from "../harness";

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

it("leaves every member the colour it was when the check finds a readiness issue", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.clearRing();
  await h.advance(1);

  const before = colours(MINIMAL_CRANE.members);

  const found = await h.check();
  await h.press("KeyC");
  await h.advance(1);
  const after = colours(MINIMAL_CRANE.members);
  await h.capture("check-no-color", "The members left uncolored");

  assertContains(
    found.issues,
    "no-ring",
    "the readiness issue a crane with no slew ring raises, so the screen is " +
      "showing the readiness row of the check's table (specs/ui.md § Build)",
  );

  for (const [index, was] of before.entries()) {
    const now = after[index]!;
    if (was === null || now === null) continue;
    if (apart(was, now) === 0) continue;
    fail(
      "the check to colour no member when a readiness issue left the " +
        "structure unsolved, so every member is drawn in the colour it was " +
        "(specs/ui.md § Build)",
      `member ${index} went from [${was.join(", ")}] to [${now.join(", ")}]`,
    );
  }
});
