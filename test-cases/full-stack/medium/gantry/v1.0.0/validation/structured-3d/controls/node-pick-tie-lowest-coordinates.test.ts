// controls/node-pick-tie-lowest-coordinates — two nodes tied under the pointer at
// the same distance from the camera, and the candidate is the lower-coordinate
// one.
//
// `specs/controls.md` § Clicks and drags: "the candidate is the nearest at most
// `NODE_PICK_PX` (`20`) logical pixels from the click, ties going to the node
// nearest the camera, and then to the node lower in `x`, then in `y`, then in
// `z`." This check is about the LAST of those rules, so the scenario has to tie
// the screen distance and the camera distance both, and it is read once on each
// of the three axes: a build that ordered `x` downward, or ordered two axes
// rightly and the third the other way, fails here.
//
// THE CAMERA IS POSED HALFWAY BETWEEN THE TWO NODES. Two lattice nodes that
// differ on one axis alone stand at the same distance from any eye whose own
// coordinate on that axis is halfway between them, which is one equation on the
// camera pose `specs/controls.md` fixes — so each probe below poses a yaw, a
// pitch and a distance that put the eye on that halfway plane, and the two nodes
// are then EXACTLY as far from the camera as each other whatever else is going
// on. The click is made at the midpoint of the two points the build says it drew
// them at, which ties the screen distance the same way. Nothing is left to
// separate them but the coordinate rule.
//
// WHICH PAIR IS USED COMES FROM WHAT THE BUILD DRAWS. Both nodes have to fall
// inside `NODE_PICK_PX` of that midpoint, and every other node of the envelope has
// to fall clearly outside it, and how far apart two nodes are drawn depends on the
// lens `specs/controls.md` leaves to the build. So the stage model below fits the
// lens to readings taken back through the build's own `project`, every node of the
// envelope is placed through it, and the pair taken is the one drawn with the
// widest margin over everything else. The model is checked again against real
// readings at each probe's camera before the click is made.

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
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this check is read on, and the envelope its lattice fills. */
const SITE = 0;

/** The widest the pair may be drawn apart, as a distance from the midpoint. */
const HALF_MAX = NODE_PICK_PX - 2;

/** The narrowest, so the click is a reading rather than a rounding. */
const HALF_MIN = 3;

/** How much farther than the pair every other node has to be drawn. */
const CLEAR_BY = 4;

/* -------------------------------------------------------------------------- */
/* Where this build draws the lattice                                         */
/* -------------------------------------------------------------------------- */
//
// `specs/controls.md` fixes where the camera stands and what it looks at and
// leaves the lens to the build, so a check that has to know which nodes are drawn
// near which cannot ask the build for all of them one at a time. It reads a
// handful of positions back through `project`, fits the one free part — the
// stage's scale and centre — to what came back, and then follows the camera pose
// the specification states for the rest. The fit is verified against its own
// readings and again at every camera pose it is used at, so a build drawing
// through something other than a camera at that pose fails the item rather than
// being measured wrongly.

/** A position, in world units. */
interface Vec {
  x: number;
  y: number;
  z: number;
}

/** A camera pose, as `specs/controls.md` § The camera states one. */
interface Pose {
  yaw: number;
  pitch: number;
  dist: number;
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
function eyeOf(camera: Pose): Vec {
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
function basisOf(camera: Pose): {
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

/** Where the build draws a world position, through any camera pose. */
interface StageModel {
  through(pose: Pose): {
    at(p: Vec): { x: number; y: number };
    depth(p: Vec): number;
  };
}

async function stageModel(h: Harness, camera: Pose): Promise<StageModel> {
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
    through(pose: Pose) {
      const frame = basisOf(pose);
      return {
        at(p: Vec) {
          const view = seenFrom(frame, p);
          const across = perspective ? view.across / view.depth : view.across;
          const above = perspective ? view.above / view.depth : view.above;
          return {
            x: fit.x.a + fit.x.b * across,
            y: fit.y.a + fit.y.b * above,
          };
        },
        depth(p: Vec) {
          return seenFrom(frame, p).depth;
        },
      };
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

/* -------------------------------------------------------------------------- */
/* The three probes                                                           */
/* -------------------------------------------------------------------------- */

/** One reading: the axis the pair differs on, and the poses that tie it. */
interface Probe {
  axis: "x" | "y" | "z";
  /** The lower node's coordinate on that axis; the other is two above it. */
  base: number;
  /** Every camera pose that stands the eye halfway between the two. */
  poses: Pose[];
}

/**
 * The three probes. Each pose below puts the eye halfway between the pair on the
 * axis it differs on — `eye.x` for the `x` probe, and so on — which is one
 * equation on the pose `specs/controls.md` fixes, so two of the three dials stay
 * free and are swept for the pose that draws some pair of nodes best.
 */
function probes(): Probe[] {
  const across: Pose[] = [];
  const along: Pose[] = [];
  for (const pitch of [15, 25, 35, 45, 55]) {
    for (const dist of [40, 60, 80]) {
      const flat = dist * Math.cos(pitch * DEG);
      if (flat <= 5) continue;
      const turn = Math.acos(5 / flat) / DEG;
      across.push({ yaw: turn, pitch, dist }, { yaw: 360 - turn, pitch, dist });
      const rise = Math.asin(5 / flat) / DEG;
      along.push({ yaw: rise, pitch, dist }, { yaw: 180 - rise, pitch, dist });
    }
  }
  const level: Pose[] = [];
  for (const pitch of [10, 12, 14, 16, 18, 20]) {
    const dist = (15 - CAMERA_TARGET.y) / Math.sin(pitch * DEG);
    if (dist < 10 || dist > 80) continue;
    for (let yaw = 0; yaw < 360; yaw += 15) level.push({ yaw, pitch, dist });
  }
  return [
    { axis: "x", base: 4, poses: across },
    { axis: "y", base: 14, poses: level },
    { axis: "z", base: 4, poses: along },
  ];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers a node tie at equal camera distance with the lower coordinate", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  const model = await stageModel(h, (await h.snapshot()).camera);
  const lattice = latticeOf(SITE);
  const key = (p: Vec): string => `${p.x},${p.y},${p.z}`;

  for (const probe of probes()) {
    const axis = probe.axis;

    // The pose, and the pair of nodes a step apart on this axis, that the build
    // draws closest together with the widest margin over every other node.
    let taken: { pose: Pose; lower: Vec; upper: Vec } | null = null;
    let widest = 0;
    for (const pose of probe.poses) {
      const view = model.through(pose);
      const drawn = lattice
        .filter((node) => view.depth(node) > 0)
        .map((node) => ({ node, at: view.at(node) }));
      const byNode = new Map(drawn.map((one) => [key(one.node), one]));
      for (const one of drawn) {
        if (one.node[axis] !== probe.base) continue;
        const upper = { ...one.node, [axis]: probe.base + 2 } as Vec;
        const other = byNode.get(key(upper));
        if (other === undefined) continue;
        const half =
          Math.hypot(one.at.x - other.at.x, one.at.y - other.at.y) / 2;
        if (half < HALF_MIN || half > HALF_MAX) continue;
        const click = {
          x: (one.at.x + other.at.x) / 2,
          y: (one.at.y + other.at.y) / 2,
        };
        if (
          click.x < HALF_MAX ||
          click.x > STAGE_W - HALF_MAX ||
          click.y < HALF_MAX ||
          click.y > STAGE_H - HALF_MAX
        ) {
          continue;
        }
        let crowd = Infinity;
        for (const each of drawn) {
          if (each === one || each === other) continue;
          crowd = Math.min(
            crowd,
            Math.hypot(each.at.x - click.x, each.at.y - click.y),
          );
        }
        const margin = crowd - half;
        if (margin < CLEAR_BY || margin <= widest) continue;
        widest = margin;
        taken = { pose, lower: one.node, upper };
      }
    }
    if (taken === null) {
      fail(
        `two lattice nodes a step apart in ${axis} drawn close enough ` +
          `together for one click to stand inside NODE_PICK_PX ` +
          `(${NODE_PICK_PX}) of both, and clear of every other node, at some ` +
          "camera pose that stands the eye halfway between them",
        "the build draws no such pair at any of them",
      );
    }
    const pair = taken;

    await h.debug.setCamera(pair.pose.yaw, pair.pose.pitch, pair.pose.dist);
    // THE FRAME AFTER THE POSE IS THIS ENGINE'S. `specs/instrumentation.md`
    // puts the camera on the Structured 3D engine and says a caller "projects
    // that world position through the engine's camera", and a game poses that
    // camera from the orbit pose its state holds as part of running a frame —
    // so a check that poses the camera and then asks where a point is drawn is
    // asking about a frame that has not been drawn yet. One frame closes it.
    // The frame carries the whole simulation, but the run is idle on the build
    // screen, so it moves nothing this check reads.
    await h.advance(1);
    const camera = (await h.snapshot()).camera;

    // The eye stands halfway between the two nodes on the axis they differ on,
    // which is what makes their distance from the camera the same number.
    const eye = eyeOf(camera);
    assertTrue(
      Math.abs(eye[axis] - (probe.base + 1)) < 1e-9,
      `the camera's ${axis} standing halfway between ${probe.base} and ` +
        `${probe.base + 2}, so the two nodes are the same distance from it ` +
        `(it stands at ${eye[axis]})`,
    );

    // And the model still describes what the build draws at this pose.
    const view = model.through(camera);
    for (const sample of SAMPLES.slice(0, 4)) {
      if (view.depth(sample) <= 1) continue;
      const drawn = await h.project(sample.x, sample.y, sample.z);
      const guess = view.at(sample);
      assertTrue(
        Math.hypot(drawn.x - guess.x, drawn.y - guess.y) <= FIT_TOLERANCE,
        `the build drawing (${sample.x}, ${sample.y}, ${sample.z}) where a ` +
          `camera at the ${axis} probe's pose draws it`,
      );
    }

    // The click: the midpoint of the two points the build drew the pair at,
    // which is the same distance from each of them.
    const lowerAt = await h.project(pair.lower.x, pair.lower.y, pair.lower.z);
    const upperAt = await h.project(pair.upper.x, pair.upper.y, pair.upper.z);
    assertTrue(
      lowerAt.visible && upperAt.visible,
      `the ${axis} probe's two nodes are on the stage`,
    );
    const click = {
      x: (lowerAt.x + upperAt.x) / 2,
      y: (lowerAt.y + upperAt.y) / 2,
    };
    const toLower = Math.hypot(click.x - lowerAt.x, click.y - lowerAt.y);
    const toUpper = Math.hypot(click.x - upperAt.x, click.y - upperAt.y);
    assertLessThanOrEqual(
      Math.max(toLower, toUpper),
      NODE_PICK_PX,
      `the ${axis} probe's two nodes both inside NODE_PICK_PX of the click`,
    );
    assertGreaterThan(
      Math.min(toLower, toUpper),
      0,
      `the ${axis} probe's nodes drawn apart from one another`,
    );
    assertLessThan(
      Math.abs(toLower - toUpper),
      0.001,
      `the ${axis} probe's two nodes the same distance from the click`,
    );

    await h.pointerMove(click.x, click.y);
    await h.advance(1);
    await h.capture(
      "state",
      `the pointer between two nodes a step apart in ${axis}`,
    );

    assertEqual(
      JSON.stringify((await h.snapshot()).pick.node),
      JSON.stringify(pair.lower),
      `the node a click between (${pair.lower.x}, ${pair.lower.y}, ` +
        `${pair.lower.z}) and (${pair.upper.x}, ${pair.upper.y}, ` +
        `${pair.upper.z}) would take: the two are the same distance from the ` +
        "click and the same distance from the camera, so the tie falls to the " +
        `node lower in ${axis} (specs/controls.md)`,
    );
  }
});
