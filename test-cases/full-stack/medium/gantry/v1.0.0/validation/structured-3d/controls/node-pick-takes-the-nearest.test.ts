// controls/node-pick-takes-the-nearest — with two nodes in range the pick takes
// the nearer of them.
//
// `specs/controls.md` § Clicks and drags: "the candidate is the NEAREST at most
// `NODE_PICK_PX` (`20`) logical pixels from the click". So being in range is not
// enough to be taken: with two nodes inside the radius the one nearer the click
// wins, and a build that answered with the first node it found in range, or with
// the one nearest the camera, would answer the other one here.
//
// THE PAIR IS CHOSEN FROM WHAT THE BUILD DRAWS. Two lattice nodes are wanted
// close together on the stage — near enough that a single click stands inside
// `NODE_PICK_PX` of both — and how close any two nodes are drawn depends on the
// lens, which `specs/controls.md` leaves to the build. So every node of the
// envelope is placed through the stage model below, and the pair taken is the one
// whose separation leaves the click clearly nearer one of them and clearly clear
// of every other node in the envelope.
//
// AND THE NEARER OF THE TWO IS THE FARTHER FROM THE CAMERA. The click sits three
// tenths of the way from it toward the other, so the node it takes is the nearer
// on the stage and the farther in the yard: a build that reached for the nearest
// node to the CAMERA — the rule that only decides a tie — answers the other one.
//
// THE PAIR STANDS ON THE STAGE. The lens decides which of the envelope's nodes
// the stage holds at all, and `specs/controls.md` leaves the lens to the build,
// so a node in front of the camera may well be drawn past the stage's edge — a
// narrower lens than another build's puts the envelope's corners there. A click
// is a stage position, so the two nodes are chosen from the ones the model puts
// on the stage with room to spare, while every node in front of the camera is
// still a candidate the click has to be clear of, because that is what a node
// pick considers.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
  assertTrue,
  fail,
} from "../assert";
import {
  CAMERA_TARGET,
  LATTICE_PITCH,
  NODE_PICK_PX,
  SITES,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The site this check is read on, and the envelope its lattice fills. */
const SITE = 0;

/** Where the click sits between the two nodes, as a share of their gap. */
const TOWARD_FAR = 0.3;

/** The widest stage gap between the pair this check can use. */
const GAP_MAX = (NODE_PICK_PX - 2) / (1 - TOWARD_FAR);

/** The narrowest, so the two distances are clearly different readings. */
const GAP_MIN = 8;

/** How much farther than the second node every other node has to be drawn. */
const CLEAR_BY = 4;

/**
 * How far inside the stage's edges both nodes of the pair are drawn, so the
 * click between them is a stage position with the pick radius around it, and
 * the model's own tolerance cannot put either node over the edge.
 */
const STAGE_INSET = NODE_PICK_PX;

/* -------------------------------------------------------------------------- */
/* Where this build draws the lattice                                         */
/* -------------------------------------------------------------------------- */
//
// `specs/controls.md` fixes where the camera stands and what it looks at and
// leaves the lens to the build, so a check that has to know WHICH lattice node
// is drawn highest cannot ask the build for all of them one at a time. It reads
// a handful of positions back through `project`, fits the one free part — the
// stage's scale and centre — to what came back, and then follows the camera pose
// the specification states for the rest. The fit is verified against its own
// readings, so a build drawing through something other than a camera at that
// pose fails the item rather than being measured wrongly.

/** A position, in world units. */
interface Vec {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

const sub = (a: Vec, b: Vec): Vec => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** Where the camera stands (`specs/controls.md` § The camera). */
function eyeOf(camera: { yaw: number; pitch: number; dist: number }): Vec {
  const yaw = camera.yaw * DEG;
  const pitch = camera.pitch * DEG;
  const flat = camera.dist * Math.cos(pitch);
  return {
    x: CAMERA_TARGET.x + flat * Math.cos(yaw),
    y: CAMERA_TARGET.y + camera.dist * Math.sin(pitch),
    z: CAMERA_TARGET.z + flat * Math.sin(yaw),
  };
}

/** The camera's own axes: it looks at `CAMERA_TARGET` with `+y` up. */
function basisOf(camera: { yaw: number; pitch: number; dist: number }): {
  eye: Vec;
  forward: Vec;
  right: Vec;
  up: Vec;
} {
  const eye = eyeOf(camera);
  const forward = unit(sub(CAMERA_TARGET, eye));
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
  return { eye, forward, right, up: cross(right, forward) };
}

/** How far a world position stands across, above, and in front of the camera. */
function seenFrom(
  basis: ReturnType<typeof basisOf>,
  p: Vec,
): { across: number; above: number; depth: number } {
  const d = sub(p, basis.eye);
  return {
    across: dot(d, basis.right),
    above: dot(d, basis.up),
    depth: dot(d, basis.forward),
  };
}

/** The least-squares line through `(t, s)`, and its worst residual. */
function fitLine(
  t: readonly number[],
  s: readonly number[],
): { a: number; b: number; res: number } {
  const n = t.length;
  const mt = t.reduce((sum, one) => sum + one, 0) / n;
  const ms = s.reduce((sum, one) => sum + one, 0) / n;
  let cov = 0;
  let spread = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (t[i]! - mt) * (s[i]! - ms);
    spread += (t[i]! - mt) * (t[i]! - mt);
  }
  const b = spread === 0 ? 0 : cov / spread;
  const a = ms - b * mt;
  let res = 0;
  for (let i = 0; i < n; i += 1) {
    res = Math.max(res, Math.abs(a + b * t[i]! - s[i]!));
  }
  return { a, b, res };
}

/** The positions the fit is taken from: spread through site 1's envelope. */
const SAMPLES: readonly Vec[] = [
  { x: 0, y: 6, z: 0 },
  { x: 10, y: 2, z: -6 },
  { x: -6, y: 14, z: 10 },
  { x: 12, y: 0, z: 12 },
  { x: -8, y: 16, z: -8 },
  { x: 4, y: 8, z: 4 },
  { x: -8, y: 0, z: 10 },
  { x: 10, y: 16, z: -8 },
];

/** How far the fit may miss its own readings before the build is unreadable. */
const FIT_TOLERANCE = 0.5;

/** Where the build draws a world position, and how far in front it stands. */
interface StageModel {
  at(p: Vec): { x: number; y: number };
  depth(p: Vec): number;
}

async function stageModel(
  h: Harness,
  camera: { yaw: number; pitch: number; dist: number },
): Promise<StageModel> {
  const basis = basisOf(camera);
  const seen: {
    across: number;
    above: number;
    depth: number;
    x: number;
    y: number;
  }[] = [];
  for (const p of SAMPLES) {
    const view = seenFrom(basis, p);
    if (view.depth <= 1) continue;
    const at = await h.project(p.x, p.y, p.z);
    seen.push({ ...view, x: at.x, y: at.y });
  }
  if (seen.length < 4) {
    fail(
      "at least four of the sample positions to stand in front of the camera " +
        "pose specs/controls.md fixes",
      `${seen.length} do`,
    );
  }
  const flat = {
    x: fitLine(
      seen.map((one) => one.across),
      seen.map((one) => one.x),
    ),
    y: fitLine(
      seen.map((one) => one.above),
      seen.map((one) => one.y),
    ),
  };
  const near = {
    x: fitLine(
      seen.map((one) => one.across / one.depth),
      seen.map((one) => one.x),
    ),
    y: fitLine(
      seen.map((one) => one.above / one.depth),
      seen.map((one) => one.y),
    ),
  };
  const perspective =
    Math.max(near.x.res, near.y.res) <= Math.max(flat.x.res, flat.y.res);
  const fit = perspective ? near : flat;
  const worst = Math.max(fit.x.res, fit.y.res);
  if (!(worst <= FIT_TOLERANCE)) {
    fail(
      "the build to draw the yard through a camera at the pose " +
        "specs/controls.md fixes, so where it draws every lattice node follows " +
        "from where it draws a few of them",
      `its projection misses that camera by ${worst.toFixed(1)} stage pixels`,
    );
  }
  return {
    at(p: Vec) {
      const view = seenFrom(basis, p);
      const across = perspective ? view.across / view.depth : view.across;
      const above = perspective ? view.above / view.depth : view.above;
      return { x: fit.x.a + fit.x.b * across, y: fit.y.a + fit.y.b * above };
    },
    depth(p: Vec) {
      return seenFrom(basis, p).depth;
    },
  };
}

/** Every lattice node of a site's envelope (`specs/world.md` § The lattice). */
function latticeOf(site: number): Vec[] {
  const envelope = SITES[site]!.envelope;
  const nodes: Vec[] = [];
  for (let x = envelope.x.min; x <= envelope.x.max; x += LATTICE_PITCH) {
    for (let y = envelope.y.min; y <= envelope.y.max; y += LATTICE_PITCH) {
      for (let z = envelope.z.min; z <= envelope.z.max; z += LATTICE_PITCH) {
        nodes.push({ x, y, z });
      }
    }
  }
  return nodes;
}

/** How far a world position stands from the camera. */
function fromCamera(
  camera: { yaw: number; pitch: number; dist: number },
  p: Vec,
): number {
  const eye = eyeOf(camera);
  return Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the nearer of two nodes that are both in range", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  const camera = (await h.snapshot()).camera;
  const model = await stageModel(h, camera);

  const nodes = latticeOf(SITE).filter((node) => model.depth(node) > 0);
  assertGreaterThan(
    nodes.length,
    0,
    "the lattice nodes in front of the camera",
  );
  const drawn = nodes.map((node) => ({ node, at: model.at(node) }));
  const onStage = drawn.filter(
    ({ at }) =>
      at.x >= STAGE_INSET &&
      at.x <= STAGE_W - STAGE_INSET &&
      at.y >= STAGE_INSET &&
      at.y <= STAGE_H - STAGE_INSET,
  );
  assertGreaterThan(
    onStage.length,
    1,
    "the lattice nodes the build draws on the stage, clear of its edges",
  );

  // The pair drawn on the stage close enough together for one click to be in
  // range of both, and clear enough of everything else in front of the camera
  // that no third node can be the answer.
  let taken: { near: Vec; other: Vec; gap: number } | null = null;
  let widest = 0;
  for (let i = 0; i < onStage.length; i += 1) {
    for (let j = i + 1; j < onStage.length; j += 1) {
      const one = onStage[i]!;
      const other = onStage[j]!;
      const gap = Math.hypot(one.at.x - other.at.x, one.at.y - other.at.y);
      if (gap < GAP_MIN || gap > GAP_MAX) continue;
      // The click stands nearer the one FARTHER from the camera.
      const far =
        fromCamera(camera, one.node) >= fromCamera(camera, other.node)
          ? one
          : other;
      const close = far === one ? other : one;
      const click = {
        x: far.at.x + TOWARD_FAR * (close.at.x - far.at.x),
        y: far.at.y + TOWARD_FAR * (close.at.y - far.at.y),
      };
      const second = (1 - TOWARD_FAR) * gap;
      let crowd = Infinity;
      for (const each of drawn) {
        if (each === one || each === other) continue;
        crowd = Math.min(
          crowd,
          Math.hypot(each.at.x - click.x, each.at.y - click.y),
        );
      }
      const margin = crowd - second;
      if (margin < CLEAR_BY || margin <= widest) continue;
      widest = margin;
      taken = { near: far.node, other: close.node, gap };
    }
  }
  if (taken === null) {
    fail(
      "two lattice nodes drawn on the stage close enough together for one " +
        `click to stand inside NODE_PICK_PX (${NODE_PICK_PX}) of both, and ` +
        "clear of every other node in the envelope",
      "the build draws no such pair at the camera pose the site opened at",
    );
  }
  const pair = taken;

  // The click, from the build's own projection of the two nodes.
  const nearAt = await h.project(pair.near.x, pair.near.y, pair.near.z);
  const otherAt = await h.project(pair.other.x, pair.other.y, pair.other.z);
  assertTrue(nearAt.visible, "the node the click should take is on the stage");
  const click = {
    x: nearAt.x + TOWARD_FAR * (otherAt.x - nearAt.x),
    y: nearAt.y + TOWARD_FAR * (otherAt.y - nearAt.y),
  };
  const toNear = Math.hypot(click.x - nearAt.x, click.y - nearAt.y);
  const toOther = Math.hypot(click.x - otherAt.x, click.y - otherAt.y);
  assertLessThanOrEqual(
    toOther,
    NODE_PICK_PX,
    "the stage distance from the click to the FARTHER of the two nodes, " +
      "against NODE_PICK_PX: both of them are in range (specs/controls.md)",
  );
  assertLessThan(
    toNear,
    toOther,
    "the stage distance from the click to the node it should take, against " +
      "the distance to the other one",
  );
  assertLessThan(
    fromCamera(camera, pair.other),
    fromCamera(camera, pair.near),
    "the other node's distance from the camera, against the taken node's: " +
      "the node the click is nearer to is the farther of the two in the yard",
  );

  await h.pointerMove(click.x, click.y);
  await h.advance(1);
  await h.capture("state", "the pointer between two lattice nodes in range");

  assertEqual(
    JSON.stringify((await h.snapshot()).pick.node),
    JSON.stringify(pair.near),
    `the node a click ${toNear.toFixed(1)} pixels from one node and ` +
      `${toOther.toFixed(1)} from another would take: both are within ` +
      `NODE_PICK_PX (${NODE_PICK_PX}), and the candidate is the nearest of ` +
      "them (specs/controls.md)",
  );
});
