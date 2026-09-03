// controls/node-pick-inside-the-envelope-only — a lattice point outside the
// envelope is never a candidate.
//
// `specs/controls.md` § Clicks and drags: "A node pick considers every lattice
// node in the envelope that stands in front of the camera". The lattice itself is
// unbounded — "the points whose coordinates are all integer multiples of
// `LATTICE_PITCH`" (`specs/world.md`) — and the envelope is what a pick reads out
// of it, so a click on a lattice point beyond the envelope takes nothing.
//
// THE POINT CLICKED IS ONE STEP OUTSIDE, AND CLEAR OF EVERYTHING INSIDE. It is
// chosen from the lattice points just above the envelope's ceiling — points a
// build that read the envelope one step too generously would offer — and the one
// taken is the one the build draws farthest from every node that IS in the
// envelope, so the answer says the point was not considered rather than that some
// other node was nearer. That every in-envelope node is more than `NODE_PICK_PX`
// away is read back from the build's own `project` before the click is made.
//
// The camera pose is the one `specs/controls.md` states and the lens is the
// build's, so where each node is drawn is worked out through the stage model
// below: it fits the lens to a handful of readings taken back through `project`
// and refuses to measure a build whose drawing does not answer to that camera.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNull, assertTrue, fail } from "../assert";
import {
  CAMERA_TARGET,
  LATTICE_PITCH,
  NODE_PICK_PX,
  SITES,
} from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this check is read on, and the envelope its lattice fills. */
const SITE = 0;

/** How far clear of every in-envelope node the click has to stand. */
const CLEARANCE = NODE_PICK_PX + 4;

/** How many lattice steps above the envelope's ceiling to look. */
const STEPS = 4;

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

it("takes no node when the click is on a lattice point outside the envelope", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  const camera = (await h.snapshot()).camera;
  const model = await stageModel(h, camera);

  const envelope = SITES[SITE]!.envelope;
  const inside = latticeOf(SITE).filter((node) => model.depth(node) > 0);
  assertGreaterThan(
    inside.length,
    0,
    "the lattice nodes in front of the camera",
  );

  /** How far the build draws `p` from the nearest node in the envelope. */
  const clearOf = (p: Vec): number => {
    const at = model.at(p);
    let nearest = Infinity;
    for (const node of inside) {
      const other = model.at(node);
      nearest = Math.min(nearest, Math.hypot(other.x - at.x, other.y - at.y));
    }
    return nearest;
  };

  // The lattice points just above the envelope's ceiling, nearest step first:
  // the first one drawn clear of everything inside is the one clicked.
  let outside: Vec | null = null;
  let clear = 0;
  for (let step = 1; step <= STEPS && outside === null; step += 1) {
    for (let x = envelope.x.min; x <= envelope.x.max; x += LATTICE_PITCH) {
      for (let z = envelope.z.min; z <= envelope.z.max; z += LATTICE_PITCH) {
        const point = { x, y: envelope.y.max + step * LATTICE_PITCH, z };
        if (model.depth(point) <= 0) continue;
        const at = model.at(point);
        if (at.x < 0 || at.x > 1280 || at.y < 0 || at.y > 720) continue;
        const gap = clearOf(point);
        if (gap > clear) {
          clear = gap;
          if (gap >= CLEARANCE) outside = point;
        }
      }
    }
  }
  if (outside === null) {
    fail(
      `a lattice point just outside site ${SITE + 1}'s envelope drawn at ` +
        `least ${CLEARANCE} pixels from every node inside it, so a click on ` +
        "it is in range of nothing that is a candidate",
      `the clearest one the build draws is ${clear.toFixed(1)} pixels clear`,
    );
  }
  const point = outside;
  assertTrue(
    point.y > envelope.y.max,
    `the clicked lattice point stands outside site ${SITE + 1}'s envelope, ` +
      `whose ceiling is y ${envelope.y.max} (specs/sites.md)`,
  );

  const at = await h.project(point.x, point.y, point.z);
  assertTrue(at.visible, "the outside lattice point is drawn on the stage");

  // And the clearance, read back through the build's own projection rather than
  // through the model: the nodes the model says are nearest are checked for real.
  const nearest = [...inside]
    .map((node) => {
      const drawn = model.at(node);
      const there = model.at(point);
      return {
        node,
        gap: Math.hypot(drawn.x - there.x, drawn.y - there.y),
      };
    })
    .sort((one, other) => one.gap - other.gap)
    .slice(0, 6);
  for (const { node } of nearest) {
    const drawn = await h.project(node.x, node.y, node.z);
    assertGreaterThan(
      Math.hypot(drawn.x - at.x, drawn.y - at.y),
      NODE_PICK_PX,
      `the stage distance from the click to the envelope's node (${node.x}, ` +
        `${node.y}, ${node.z}), against NODE_PICK_PX`,
    );
  }

  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  await h.capture(
    "state",
    "the pointer on a lattice point outside the envelope",
  );

  assertNull(
    (await h.snapshot()).pick.node,
    `the node a click on the lattice point (${point.x}, ${point.y}, ` +
      `${point.z}) would take: it lies outside the envelope, and a node pick ` +
      "considers the lattice nodes in the envelope alone (specs/controls.md)",
  );
});
