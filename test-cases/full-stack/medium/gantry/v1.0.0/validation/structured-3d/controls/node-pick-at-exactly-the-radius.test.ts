// controls/node-pick-at-exactly-the-radius — a node exactly `NODE_PICK_PX` from
// the click is still a candidate.
//
// `specs/controls.md` § Clicks and drags: "the candidate is the nearest at most
// `NODE_PICK_PX` (`20`) logical pixels from the click". AT MOST is inclusive, so
// a node exactly twenty pixels away is in range and a build that took the radius
// as an exclusive one answers nothing here. That boundary is this check's whole
// subject: the reading either side of it belongs to `controls/node-pick-radius`.
//
// THE NODE IS THE ONE THE BUILD DRAWS HIGHEST, and the click stands exactly
// `NODE_PICK_PX` pixels straight above it. Every other lattice node in the
// envelope is drawn at or below that node, so each of them is at least twenty
// pixels from the click as well and none of them can be the nearer candidate —
// which is what lets this check name the node it expects without any assumption
// about the build's lens.
//
// WHICH NODE THAT IS COMES FROM THE BUILD'S OWN PROJECTION. The camera pose is
// the one `specs/controls.md` states, so where each node stands relative to the
// camera is fixed; the one free part is the lens, and the stage model below fits
// it to a handful of readings taken back through `project` and refuses to
// measure a build whose drawing does not answer to that camera at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue, fail } from "../assert";
import {
  CAMERA_TARGET,
  LATTICE_PITCH,
  NODE_PICK_PX,
  SITES,
} from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this check is read on, and the envelope its lattice fills. */
const SITE = 0;

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the node standing exactly NODE_PICK_PX from the click", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  const camera = (await h.snapshot()).camera;
  const model = await stageModel(h, camera);

  // The node the build draws highest, among those standing in front of the
  // camera — the only ones a node pick considers at all.
  const nodes = latticeOf(SITE).filter((node) => model.depth(node) > 0);
  assertGreaterThan(
    nodes.length,
    0,
    "the lattice nodes in front of the camera",
  );
  let top = nodes[0]!;
  for (const node of nodes) {
    if (model.at(node).y < model.at(top).y) top = node;
  }
  let crowd = Infinity;
  for (const node of nodes) {
    if (node === top) continue;
    const at = model.at(node);
    const there = model.at(top);
    crowd = Math.min(crowd, Math.hypot(at.x - there.x, at.y - there.y));
  }
  assertGreaterThan(
    crowd,
    1,
    "the stage gap between the highest-drawn node and its nearest neighbour, " +
      "so the click above it has one nearest node rather than two",
  );

  const at = await h.project(top.x, top.y, top.z);
  assertTrue(at.visible, "the highest-drawn node is on the stage");
  assertGreaterThan(
    at.y - NODE_PICK_PX,
    0,
    "the room above the highest-drawn node for the click to be on the stage",
  );

  await h.pointerMove(at.x, at.y - NODE_PICK_PX);
  await h.advance(1);
  await h.capture(
    "state",
    `the pointer exactly ${NODE_PICK_PX} pixels from a lattice node`,
  );

  assertEqual(
    JSON.stringify((await h.snapshot()).pick.node),
    JSON.stringify(top),
    `the node a click exactly NODE_PICK_PX (${NODE_PICK_PX}) pixels away ` +
      "would take: the radius is stated as 'at most', so a node standing on it " +
      "is still a candidate (specs/controls.md)",
  );
});
