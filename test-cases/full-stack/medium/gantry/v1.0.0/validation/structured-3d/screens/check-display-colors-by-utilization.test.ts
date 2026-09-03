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
// `(0, 0, 2)-(0, 2, 2)`: the same material, the same length, and both vertical,
// so a build that drew them alike before the check has only the ramp to tell them
// apart afterwards. A counterweight hung at the rail tip is what puts the
// utilizations apart — the leg under the load carries several times what the leg
// across the tower does — and the check's own report of the two is read first,
// because the ramp can only be held to the figures the game itself says it is
// colouring.
//
// THE CHECK IS RUN THROUGH THE PLAYER'S OWN KEY, because this point is about what
// the CHECK DISPLAY shows: `specs/controls.md` binds `check` to `KeyC`, and
// `h.check()` is the pure reading beside it, which "displays nothing"
// (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import {
  MINIMAL_CRANE,
  createHarness,
  drawnObjects,
  openSite,
  standMinimalCrane,
  type DesignMember,
  type DrawnObject,
  type Harness,
  type Vec3,
} from "../harness";

/** The two tower legs: same material, same length, both vertical. */
const LEGS = [1, 2] as const;

/** The node the counterweight hangs on: the rail tip of the minimal crane. */
const WEIGHT = { x: 4, y: 4, z: 0 } as const;

/** How far apart the two legs' utilizations must stand for the ramp to read. */
const SPREAD = 0.2;

/** How far apart two colours must be to be different colours to a player. */
const DIFFERENT = 24;

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
    const [from, to] = endsOf(MINIMAL_CRANE.members[id]!);
    const colour = memberColour(h, from, to);
    if (colour === null) {
      fail(
        `member ${id} to be drawn along the segment between its own two ` +
          "nodes, so the colour the check gave it can be read " +
          "(specs/ui.md § Build)",
        `nothing is drawn along (${from.x}, ${from.y}, ${from.z}) to ` +
          `(${to.x}, ${to.y}, ${to.z})`,
      );
    }
    return colour;
  });

  if (apart(colors[0]!, colors[1]!) < DIFFERENT) {
    fail(
      "two members carrying different utilizations to be drawn in different " +
        "colours, as a monotone ramp from slack to the limit draws them " +
        `(specs/ui.md § Build, specs/overview.md): member ${LEGS[0]} at ` +
        `utilization ${utilizations[0]!.toFixed(3)} and member ${LEGS[1]} at ` +
        `${utilizations[1]!.toFixed(3)}`,
      `both are drawn [${colors[0]!.join(", ")}] and ` +
        `[${colors[1]!.join(", ")}], ` +
        `${apart(colors[0]!, colors[1]!).toFixed(1)} apart`,
    );
  }
});
