// presentation/broken-member-unmistakable — a member that breaks stops being
// drawn as an intact one.
//
// specs/overview.md, "Visual design", the row for utilization: "While the tape
// runs, each member's color reads its utilization on a monotone ramp from slack
// to its limit, a member at breaking point stands out, and a broken member is
// unmistakable." specs/statics.md, "Utilization and breakage": "every member
// whose utilization exceeds `1` breaks: all of them are removed at once,
// permanently for the rest of the run, and they join the run's list of broken
// members in ascending member-id order."
//
// WHICH LEAVES THE BUILD TWO ANSWERS AND ASKS FOR EITHER. A broken member may
// leave the drawing altogether or be drawn in a broken state; what the
// specification fixes is that it is unmistakable, so what is on screen where it
// stood does not go on looking like an intact member. That is the reading: the
// yard on the tick before the break and the yard on the tick after, compared
// along the segment the member that `run.broken` names runs between.
//
// THE CONTROL IS AN INTACT MEMBER WELL CLEAR OF IT. Two readings a tick apart
// differ wherever anything moved, so the control is what says the change is this
// member's: the member the run still carries, furthest from the broken one, has
// to stand as it was. A build that redrew the yard, or that lost the whole
// structure from the picture, answers the first half and fails here.
//
// NOTHING IN THE YARD MOVES. The yard is emptied — no loads, no obstacles — and
// the tape turns the `grip`, which specs/rigging.md says "turns the bare hook,
// visibly and to no other effect", at one degree a second: the run is live, the
// tape is not finished, and no axis carries the crane anywhere. So between the
// two frames the only thing that has happened in the yard is the break.
//
// THE CRANE IS THE SMALLEST ONE THAT STANDS with one of its four mast ties left
// out and a counterweight hung at the arm's tip, which puts a single member over
// its capacity on the run's first tick. Which member that is, this check does not
// say: it reads `run.broken`, which specs/state.md defines as "Member ids, in the
// order they broke".

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type MemberView,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The mast tie left out, which is what puts one member over its capacity. */
const OMITTED = 16;

/** The crane: the smallest one that stands, one tie short, with ballast at the tip. */
const CRANE: CraneDesign = {
  ...MINIMAL_CRANE,
  members: MINIMAL_CRANE.members.filter((_member, index) => index !== OMITTED),
  counterweights: [[4, 4, 0]],
};

/**
 * The tape: turn the grip, slowly, a long way.
 *
 * A run needs a tape (`empty-program` refuses the start, specs/program.md), and
 * this is the one that changes nothing: the grip turns the bare hook and applies
 * "no force to anything" (specs/rigging.md), and a target this far off keeps the
 * step live for far longer than this check watches, so the run neither ends nor
 * moves the crane.
 */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 1 }] },
];

/** The camera: the start pose, drawn in close, so the crane fills the stage. */
const CAMERA = { yaw: 45, pitch: 30, dist: 20 } as const;

/** How many points are read along a member's segment. */
const SAMPLES = 10;

/** How many of them the broken member's drawing must part at. */
const NEEDED = 8;

/** How long a member must be to be read, in world units. */
const READABLE = 2;

/** How far from the broken member the control must stand, in world units. */
const CLEAR = 2;

/** How near a point a body must come to count as drawn there, world units. */
const REACH = 0.3;

/**
 * How far a body's colour may drift and still be the same drawing, out of 441.
 *
 * The run screen colours every member by its utilization every tick
 * (specs/overview.md), and a tick that breaks one member shifts what all the
 * others carry — so every member's colour moves a little on this tick, and a
 * reading that called any movement a change would call the whole crane changed.
 * A twelfth of the colour cube is a step along the ramp too small to read; the
 * break itself moves the member that broke by far more, and this check's own
 * failure message says by how much.
 */
const UNCHANGED = 35;

/* -------------------------------------------------------------------------- */
/* Reading the yard                                                           */
/* -------------------------------------------------------------------------- */
//
// THIS ENGINE'S HALF OF THIS POINT IS WHERE THE PICTURE IS READ. Under this
// engine the yard is the engine's own retained scene — "what `render` added on
// one frame is still there on the next… this is what lets a check find an object
// by name and read its world position with no pixels involved" (`rendering.ts`)
// — and this process has no GPU, so the yard has no pixels at all. An engineless
// build owns its own renderer, so its version of this point photographs the page
// and reads colours at projected stage points; here the same question is asked in
// WORLD units, of the bodies the build put in the scene. That is the stronger
// reading of the two: a body drawn in the right part of the picture but in the
// wrong place in the world passes there and fails here.
//
// NOTHING IS FOUND BY NAME. What a build calls the objects it renders is its own;
// where it puts them is not.

/** One body the yard shows, where it stands, and what it is drawn in. */
interface Body {
  /** Its world extent, rounded, which is what identifies it between readings. */
  place: string;
  box: THREE.Box3;
  /** Its material's colour, or `null` when it carries none. */
  colour: [number, number, number] | null;
}

/**
 * Every body the yard SHOWS, with its world extent and its colour.
 *
 * A body is anything the build put in the scene that occupies space — a mesh, a
 * line, a cloud of points. Hidden bodies draw nothing: a build is free to keep a
 * pool and hide what it is not using, and the engine's scene retains both.
 */
function bodies(harness: Harness): Body[] {
  const found: Body[] = [];
  harness.engine.scene.traverse((object) => {
    const drawn = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isPoints?: boolean;
    };
    if (
      drawn.isMesh !== true &&
      drawn.isLine !== true &&
      drawn.isPoints !== true
    ) {
      return;
    }
    for (
      let node: THREE.Object3D | null = object;
      node !== null;
      node = node.parent
    ) {
      if (!node.visible) return;
    }
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial> | undefined;
    const hex = material?.color?.getHexString();
    found.push({
      place: [
        object.type,
        box.min.toArray().map((one) => one.toFixed(3)).join(),
        box.max.toArray().map((one) => one.toFixed(3)).join(),
      ].join("|"),
      box,
      colour:
        hex === undefined
          ? null
          : [
              Number.parseInt(hex.slice(0, 2), 16),
              Number.parseInt(hex.slice(2, 4), 16),
              Number.parseInt(hex.slice(4, 6), 16),
            ],
    });
  });
  return found;
}

/** How far two colours stand apart, on the 0-441 scale the cube spans. */
function apart(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Every body that is drawn differently between two readings: one that came or
 * went, or one that stayed and changed colour by more than `UNCHANGED`.
 */
function changedBodies(
  before: readonly Body[],
  after: readonly Body[],
): Body[] {
  const index = (read: readonly Body[]): Map<string, Body[]> => {
    const map = new Map<string, Body[]>();
    for (const body of read) {
      const held = map.get(body.place);
      if (held === undefined) map.set(body.place, [body]);
      else held.push(body);
    }
    return map;
  };
  const was = index(before);
  const now = index(after);
  const changed: Body[] = [];
  for (const [place, bodiesNow] of now) {
    const bodiesWas = was.get(place) ?? [];
    if (bodiesWas.length !== bodiesNow.length) {
      changed.push(...bodiesNow);
      continue;
    }
    for (const [at, body] of bodiesNow.entries()) {
      const before = bodiesWas[at]!;
      if (body.colour === null || before.colour === null) {
        if (body.colour !== before.colour) changed.push(body);
        continue;
      }
      if (apart(body.colour, before.colour) > UNCHANGED) changed.push(body);
    }
  }
  for (const [place, bodiesWas] of was) {
    if (!now.has(place)) changed.push(...bodiesWas);
  }
  return changed;
}

/** How many of `changed` reach within `radius` world units of `at`. */
function changedNear(
  changed: readonly Body[],
  at: THREE.Vector3,
  radius: number,
): number {
  const ball = new THREE.Sphere(at, radius);
  return changed.filter((body) => body.box.intersectsSphere(ball)).length;
}

/** The shortest distance from a point to a segment, in world units. */
function toSegment(
  point: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): number {
  const nearest = new THREE.Vector3();
  new THREE.Line3(a, b).closestPointToPoint(point, true, nearest);
  return nearest.distanceTo(point);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes the picture where a broken member stood and leaves the rest of the crane alone", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, TAPE);
  await h.debug.setCamera(CAMERA.yaw, CAMERA.pitch, CAMERA.dist);

  const started = await startRun(h);
  assertTrue(
    started.run.broken.length === 0,
    "no member broken at the run's first tick, since nothing has ticked at " +
      "the call (specs/state.md)",
  );
  assertTrue(
    started.run.axes.grip.rate <= GRIP_MAX_RATE,
    "the grip command this tape carries to be one the editor accepts " +
      "(specs/program.md)",
  );

  // Where each member runs. Nothing turns the arm, so this holds for both
  // readings.
  const drawn = started.structure.members.map((member) => {
    const a = new THREE.Vector3(member.a.x, member.a.y, member.a.z);
    const b = new THREE.Vector3(member.b.x, member.b.y, member.b.z);
    return {
      member,
      a,
      b,
      along: Array.from({ length: SAMPLES }, (_unused, i) =>
        a.clone().lerp(b, (i + 0.5) / SAMPLES),
      ),
    };
  });

  // The yard the run's first tick is about to be drawn from. `draw` runs the
  // build's own `render` over the state as it stands and advances nothing, so
  // this is the crane as it is at tick 0 rather than as some earlier frame left
  // it — `startRun` poses the run and no frame has run since.
  await h.draw();
  const before = bodies(h);
  const ticked = await runTicks(h, 1);
  const after = bodies(h);
  const changed = changedBodies(before, after);
  await h.capture("broken", "The yard after the break");

  assertGreaterThanOrEqual(
    ticked.run.broken.length,
    1,
    "a member to break on this run's first tick, since the posed crane " +
      "carries one past its capacity (specs/statics.md)",
  );

  // The broken member read is the one drawn longest, so the reading has the most
  // of the picture to stand on; the control is the intact member drawn furthest
  // from it.
  const gone = drawn
    .filter(({ member }) => ticked.run.broken.includes(member.id))
    .filter(({ a, b }) => a.distanceTo(b) >= READABLE)
    .sort((one, two) => two.a.distanceTo(two.b) - one.a.distanceTo(one.b));
  assertGreaterThanOrEqual(
    gone.length,
    1,
    `a broken member at least ${READABLE} world units long, which is what ` +
      "this check reads its drawing along",
  );
  const broken = gone[0]!;

  const controls = drawn
    .filter(({ member }) => !ticked.run.broken.includes(member.id))
    .filter(({ a, b }) => a.distanceTo(b) >= READABLE)
    .map((candidate) => ({
      candidate,
      away: Math.min(
        ...candidate.along.map((point) => toSegment(point, broken.a, broken.b)),
      ),
    }))
    .sort((one, two) => two.away - one.away);
  assertGreaterThanOrEqual(
    controls.length,
    1,
    `an intact member at least ${READABLE} world units long to read as the ` +
      "control, which the crane still carries",
  );
  assertGreaterThanOrEqual(
    controls[0]!.away,
    CLEAR,
    `the control member to stand at least ${CLEAR} world units clear of the ` +
      "broken one, so the two readings are of two different places",
  );
  const control = controls[0]!.candidate;

  const parted = broken.along.filter(
    (point) => changedNear(changed, point, REACH) > 0,
  ).length;
  assertGreaterThanOrEqual(
    parted,
    NEEDED,
    `${NEEDED} of the ${SAMPLES} points along member ${broken.member.id}'s ` +
      `segment — from (${broken.member.a.x}, ${broken.member.a.y}, ` +
      `${broken.member.a.z}) to (${broken.member.b.x}, ${broken.member.b.y}, ` +
      `${broken.member.b.z}), which run.broken names — to change on the tick ` +
      "it breaks, since a broken member is unmistakable (specs/overview.md)",
  );

  const disturbed = control.along.filter(
    (point) => changedNear(changed, point, REACH) > 0,
  ).length;
  assertLessThanOrEqual(
    disturbed,
    0,
    `member ${control.member.id}, which the run still carries and which is ` +
      "clear of the broken one, to stand unchanged across the same " +
      "tick: it is the BROKEN member that stops being drawn as an intact one " +
      `(specs/overview.md); it changed at ${disturbed} of the ${SAMPLES} ` +
      "points read along it",
  );
});
