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
// HOW A MEMBER'S COLOUR IS READ. The yard is a 3D scene, so what a member is
// drawn in is read off the page's own composited picture at points along the
// member's projected segment — the build says where it drew each node
// (`project`), and the points are taken away from the ends, where members meet
// and one hides another. A point is only used when it is showing the SCENE rather
// than a readout: the camera is turned a few degrees and back, twice — once
// before the check and once after it — and a point whose colour does not move
// with the camera is a point some readout is standing on, which is the check
// display's own panel and not a member. Nothing here reads a colour VALUE: the
// palette is the build's, and what this point is about is that the check left
// every member exactly as it drew it.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
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
import { STAGE_H, STAGE_W } from "../constants";

/** How far the camera is turned to tell the scene from the readouts, degrees. */
const JIGGLE = 8;

/** How far apart two colours must be for the turn to have moved that point. */
const MOVED = 8;

/** Where along a member colours are read, away from the ends it meets others at. */
const ALONG = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

/** Fewer usable points than this and the crane was never really in view. */
const ENOUGH = 12;

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

/** Points along every member's projected segment, away from its ends. */
async function alongMembers(
  harness: Harness,
  members: readonly DesignMember[],
): Promise<At[]> {
  const points: At[] = [];
  for (const [a, b] of members) {
    const from = await harness.project(a[0], a[1], a[2]);
    const to = await harness.project(b[0], b[1], b[2]);
    for (const t of ALONG) {
      points.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
  }
  return points;
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

  const points = await alongMembers(h, UNBRACED.members);
  const [before, beforeTurned] = await withAndWithoutATurn(h);

  const found = await h.check();
  await h.press("KeyC");
  const [after, afterTurned] = await withAndWithoutATurn(h);
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

  const scene = points.filter(
    (at) =>
      apart(colorAt(before, at), colorAt(beforeTurned, at)) >= MOVED &&
      apart(colorAt(after, at), colorAt(afterTurned, at)) >= MOVED,
  );
  assertGreaterThan(
    scene.length,
    ENOUGH,
    "points on the crane's members that the camera moves, which is what a " +
      "colour can be read at (specs/overview.md § Visual design)",
  );

  const colored = scene.filter(
    (at) => apart(colorAt(before, at), colorAt(after, at)) > 0,
  );
  if (colored.length > 0) {
    const at = colored[0]!;
    fail(
      "the check to colour no member of a structure that does not stand, so " +
        "every member is drawn in the colour it was (specs/ui.md § Build)",
      `${colored.length} of ${scene.length} points on the members changed: ` +
        `(${at.x.toFixed(0)}, ${at.y.toFixed(0)}) went from ` +
        `[${colorAt(before, at).join(", ")}] to ` +
        `[${colorAt(after, at).join(", ")}]`,
    );
  }
});
