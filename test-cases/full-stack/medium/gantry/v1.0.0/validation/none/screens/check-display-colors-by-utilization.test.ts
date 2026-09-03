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
// they take the same light from the same angles and a build that drew them alike
// before the check has only the ramp to tell them apart afterwards. A
// counterweight hung at the rail tip is what puts the utilizations apart — the
// leg under the load carries several times what the leg across the tower does —
// and the check's own report of the two is read first, because the ramp can only
// be held to the figures the game itself says it is colouring.
//
// HOW A MEMBER'S COLOUR IS READ. The yard is a 3D scene, so the colour is read
// off the page's own composited picture at points along the member's projected
// segment (the build says where it drew each node), taken from the middle of the
// member, where no other member meets it. Only points that MOVE WITH THE CAMERA
// are used — the camera is turned a few degrees and back, and a point that did
// not change is a readout standing in front of the yard rather than the yard —
// and the colour taken for the member is the one most of those points agree on,
// so a shaded face or an edge pixel does not stand for the member.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type DesignMember,
  type Harness,
} from "../harness";
import { STAGE_H, STAGE_W } from "../constants";

/** The two tower legs: same material, same length, both vertical. */
const LEGS = [1, 2] as const;

/** The node the counterweight hangs on: the rail tip of the minimal crane. */
const WEIGHT = { x: 4, y: 4, z: 0 } as const;

/** How far apart the two legs' utilizations must stand for the ramp to read. */
const SPREAD = 0.2;

/** How far apart two colours must be to be different colours to a player. */
const DIFFERENT = 24;

/** How far the camera is turned to tell the scene from the readouts, degrees. */
const JIGGLE = 8;

/** How far apart two colours must be for the turn to have moved that point. */
const MOVED = 8;

/** Colours within this of each other are the same colour on one member. */
const SHADE = 12;

/** Where along a member colours are read: its middle, clear of its ends. */
const ALONG = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65];

/** How many of those points must agree before a colour stands for the member. */
const AGREEING = 3;

/** A picture of the page, RGBA, four bytes per pixel, row-major. */
interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A point on the logical stage. */
interface At {
  x: number;
  y: number;
}

/** The page as it stands, composited: the 3D yard with the readouts over it. */
async function picture(harness: Harness): Promise<Picture> {
  const png = await harness.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

/** What is drawn at a logical stage position. */
function colorAt(shot: Picture, at: At): [number, number, number] {
  const x = Math.min(
    Math.max(Math.round((at.x / STAGE_W) * shot.width), 0),
    shot.width - 1,
  );
  const y = Math.min(
    Math.max(Math.round((at.y / STAGE_H) * shot.height), 0),
    shot.height - 1,
  );
  const i = (y * shot.width + x) * 4;
  return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
}

/** How far two colours stand apart. */
function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** Points along one member's projected segment, over its middle. */
async function alongMember(
  harness: Harness,
  member: DesignMember,
): Promise<At[]> {
  const [a, b] = member;
  const from = await harness.project(a[0], a[1], a[2]);
  const to = await harness.project(b[0], b[1], b[2]);
  return ALONG.map((t) => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  }));
}

/** The picture as it stands, and the picture with the camera turned a little. */
async function withAndWithoutATurn(
  harness: Harness,
): Promise<[Picture, Picture]> {
  const { camera } = await harness.snapshot();
  await harness.advance(1);
  const held = await picture(harness);
  await harness.debug.setCamera(camera.yaw + JIGGLE, camera.pitch, camera.dist);
  await harness.advance(1);
  const turned = await picture(harness);
  await harness.debug.setCamera(camera.yaw, camera.pitch, camera.dist);
  await harness.advance(1);
  return [held, turned];
}

/** The colour most of a member's sample points agree on, or `null`. */
function agreedColor(
  colors: readonly [number, number, number][],
): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let most = 0;
  for (const candidate of colors) {
    const votes = colors.filter((one) => apart(one, candidate) <= SHADE).length;
    if (votes > most) {
      most = votes;
      best = candidate;
    }
  }
  return most >= AGREEING ? best : null;
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
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.addCounterweight(WEIGHT.x, WEIGHT.y, WEIGHT.z);

  const points = [
    await alongMember(h, MINIMAL_CRANE.members[LEGS[0]]!),
    await alongMember(h, MINIMAL_CRANE.members[LEGS[1]]!),
  ];

  const found = await h.check();
  await h.press("KeyC");
  const [after, turned] = await withAndWithoutATurn(h);
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

  const colors = points.map((along, which) => {
    const scene = along.filter(
      (at) => apart(colorAt(after, at), colorAt(turned, at)) >= MOVED,
    );
    const color = agreedColor(scene.map((at) => colorAt(after, at)));
    if (color === null) {
      fail(
        `member ${LEGS[which]!} to be drawn where the build says it drew it, ` +
          "so the colour the check gave it can be read (specs/ui.md § Build)",
        `${scene.length} of ${along.length} points along it move with the ` +
          "camera, and no colour is shared by three of them",
      );
    }
    return color;
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
