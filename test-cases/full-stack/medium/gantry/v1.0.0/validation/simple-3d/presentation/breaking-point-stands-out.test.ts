// presentation/breaking-point-stands-out — the top of the utilization ramp is not
// just another step along it.
//
// specs/overview.md, "Visual design", the row for utilization: "While the tape
// runs, each member's color reads its utilization on a monotone ramp from slack
// to its limit, a member at breaking point stands out, and a broken member is
// unmistakable." The middle clause is this point: a ramp that climbed evenly from
// slack to the limit would satisfy the first clause and leave a member about to
// break looking like one more shade — which is what "stands out" is written
// against, since a player has to catch it BEFORE it breaks.
//
// SO WHAT IS READ IS THE RAMP'S OWN RATE, over equal steps of utilization. One
// member is watched through one run as its load climbs, and its colour is read at
// three loads that are the same distance apart: the highest the run reaches,
// and two equal steps below it. If the top of the ramp is just another step, the
// colour moves as far over the lower step as over the upper one; a build that
// makes breaking point stand out moves it further over the upper one.
//
// ONE MEMBER RATHER THAN THREE, and that is the whole reason this point is read
// this way. A member's drawn colour is its ramp colour under the yard's light,
// and how much light it catches depends on which way it faces — so three members
// compared against each other measure their three orientations as much as the
// ramp. The same member at three moments faces the same way in the same light,
// so what is left between the three readings is the ramp alone.
//
// THE STEPS ARE EQUAL BY CONSTRUCTION, which is what makes the comparison fair:
// the lower step is never smaller than the upper one, so a ramp that climbs
// evenly fails and only one that climbs FASTER at the top passes.
//
// NOTHING MOVES BUT THE TROLLEY AND WHAT HANGS FROM IT. The yard is emptied and
// one load is put where the hook starts (the track's origin, `HOIST_START` below
// it), the tape takes it and then drives the trolley out to the track's far end.
// Carrying that weight further and further from the tower walks the arm's members
// up the ramp from slack to breaking point without turning the arm, so every
// reading is of the same member drawn in the same place on the stage. Nothing
// else is in the yard: no other load, no obstacle, no counterweight.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import {
  CREAK_THRESHOLD,
  HOIST_START,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
  type LoadPose,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/**
 * The load the crane picks up, at rest where the hook starts.
 *
 * The run's starting posture is `trolley` `0` — the track's origin — and `hoist`
 * `HOIST_START` (specs/program.md), so the hook hangs `HOIST_START` below the
 * origin of the crane's own track. Standing the load's lift point exactly there
 * puts it inside `ATTACH_RADIUS` of the hook, so the tape's `attach` takes it
 * (specs/rigging.md).
 */
const LOAD_CLASS = "crate" as const;
const LOAD_MASS = 60;
const TRACK_ORIGIN = { x: 0, y: 4, z: 0 } as const;
const LOAD_START: LoadPose = {
  x: TRACK_ORIGIN.x,
  y: TRACK_ORIGIN.y - HOIST_START,
  z: TRACK_ORIGIN.z,
  yaw: 0,
};

/** The tape: take the load, then carry it out to the track's far end. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "attach" },
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 4, rate: TROLLEY_MAX_RATE }],
  },
];

/** The camera: the start pose, drawn in close, so the arm fills the stage. */
const CAMERA = { yaw: 45, pitch: 30, dist: 20 } as const;

/** The arm members this point may watch: the long ones, drawn clear. */
const CANDIDATES: readonly (readonly [Vec3, Vec3])[] = [
  [
    { x: 2, y: 4, z: 0 },
    { x: 0, y: 8, z: 0 },
  ],
  [
    { x: 0, y: 8, z: 0 },
    { x: 4, y: 4, z: 0 },
  ],
  [
    { x: 2, y: 4, z: 2 },
    { x: 0, y: 8, z: 0 },
  ],
  [
    { x: 0, y: 4, z: 2 },
    { x: 0, y: 8, z: 0 },
  ],
];

/** How often the run is photographed, and how far it is watched, in ticks. */
const EVERY = 4;
const WATCH = 160;

/** The widest equal step this point asks for, in utilization. */
const STEP = 0.25;

/** The narrowest it will settle for. */
const NARROWEST = 0.15;

/** How far apart two colours on the ramp must read, out of 441. */
const READS = 50;

/* -------------------------------------------------------------------------- */
/* Reading a member's colour                                                  */
/* -------------------------------------------------------------------------- */
//
// THIS ENGINE'S HALF OF THIS POINT IS WHERE THE COLOUR IS READ. Under this engine
// the yard is the engine's own retained scene — "what `render` added on one frame
// is still there on the next… this is what lets a check find an object by name
// and read its world position with no pixels involved" (`rendering.ts`) — and
// this process has no GPU, so the yard has no pixels at all. An engineless build
// owns its own renderer, so its version of this point photographs the page and
// samples colours along a member's projected segment; here the colour is read off
// the body the build drew for that member, which is the same colour without the
// light, the depth sorting and the anti-aliasing in the way.
//
// THE MEMBER IS FOUND BY ITS GEOMETRY AND NEVER BY A NAME. What a build calls the
// objects it renders is its own; where it puts them is not. A member drawn between
// two nodes is whatever the build showed that spans exactly that segment — one
// body whose world bounding box is centred on the segment's midpoint and whose
// diagonal is the segment's own length, give or take the thickness a member is
// drawn with.

/** How far an object's centre may sit from a member's midpoint, world units. */
const CENTRED = 0.25;

/** How much longer than the member its drawn body may be, world units. */
const THICKNESS = 1;

/** A colour as a player reads it: three channels, `0`–`255`. */
type Rgb = readonly [number, number, number];

/** How far two colours stand apart, on the 0-441 scale the cube spans. */
function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A three colour as the three channels a player reads. */
function rgbOf(color: THREE.Color): Rgb {
  const hex = color.getHexString();
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * The colour the build drew the member between two nodes in, or `null` when
 * nothing shown spans it.
 *
 * The body's material's `color`, blended with its `emissive`: a build is free to
 * carry the ramp on either, and a member that reads as one colour to a player
 * reads as that pair here. A hidden body answers for nothing — a build is free to
 * keep a pool and hide what it is not using, and the engine's scene retains both.
 */
function memberColour(
  harness: Harness,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): Rgb | null {
  const a = new THREE.Vector3(from.x, from.y, from.z);
  const b = new THREE.Vector3(to.x, to.y, to.z);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const length = a.distanceTo(b);

  let found: Rgb | null = null;
  harness.engine.scene.traverse((object) => {
    if (found !== null) return;
    if (!(object as unknown as { isMesh?: boolean }).isMesh) return;
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
    const centre = box.getCenter(new THREE.Vector3());
    if (centre.distanceTo(midpoint) > CENTRED) return;
    const diagonal = box.getSize(new THREE.Vector3()).length();
    if (diagonal < length || diagonal > length + THICKNESS) return;
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial>;
    const base = material.color === undefined ? null : rgbOf(material.color);
    const glow =
      material.emissive === undefined ? null : rgbOf(material.emissive);
    if (base === null && glow === null) return;
    const one = base ?? [0, 0, 0];
    const two = glow ?? [0, 0, 0];
    const parts = base !== null && glow !== null ? 2 : 1;
    found = [
      Math.round((one[0] + two[0]) / parts),
      Math.round((one[1] + two[1]) / parts),
      Math.round((one[2] + two[2]) / parts),
    ];
  });
  return found;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves a member's colour further over the step into breaking point", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, MINIMAL_CRANE);
  await addOneLoad(h, LOAD_CLASS, LOAD_MASS, LOAD_START, LOAD_START);
  await poseTape(h, TAPE);
  await h.debug.setCamera(CAMERA.yaw, CAMERA.pitch, CAMERA.dist);
  await startRun(h);

  // Nothing turns the arm, so each candidate stands where it stands for the
  // whole run and is read in the same place at every load.
  const drawn = CANDIDATES.map(([from, to]) => ({ from, to }));

  // The run, photographed every `EVERY` ticks: what each candidate carries, and
  // what it is drawn in.
  const series: { load: number; colour: Rgb }[][] = drawn.map(() => []);
  let ids: (number | undefined)[] = [];
  for (let tick = EVERY; tick <= WATCH; tick += EVERY) {
    const state = await runTicks(h, EVERY);
    if (state.run.phase !== "running" || state.run.broken.length > 0) break;
    if (ids.length === 0) {
      ids = drawn.map(
        ({ from, to }) =>
          state.structure.members.find(
            (m) =>
              (m.a.x === from.x &&
                m.a.y === from.y &&
                m.a.z === from.z &&
                m.b.x === to.x &&
                m.b.y === to.y &&
                m.b.z === to.z) ||
              (m.b.x === from.x &&
                m.b.y === from.y &&
                m.b.z === from.z &&
                m.a.x === to.x &&
                m.a.y === to.y &&
                m.a.z === to.z),
          )?.id,
      );
      assertTrue(
        ids.every((id) => id !== undefined),
        "every member this point may watch to stand in the posed crane " +
          "(specs/structure.md)",
      );
    }
    for (const [index, member] of drawn.entries()) {
      const force = state.run.forces.find((f) => f.id === ids[index]);
      const colour = memberColour(h, member.from, member.to);
      if (force === undefined || colour === null) continue;
      series[index]!.push({ load: force.utilization, colour });
    }
  }

  // The member that climbed highest is the one that reaches breaking point.
  const climbed = series.map((readings) =>
    readings.reduce((most, one) => Math.max(most, one.load), 0),
  );
  const watched = climbed.indexOf(Math.max(...climbed));
  const readings = series[watched]!;
  assertGreaterThanOrEqual(
    readings.length,
    3,
    "at least three readings of the watched member over the run, which is " +
      "what a step along the ramp is measured between",
  );

  const top = readings.reduce((most, one) =>
    one.load > most.load ? one : most,
  );
  const bottom = readings.reduce((least, one) =>
    one.load < least.load ? one : least,
  );
  assertGreaterThanOrEqual(
    top.load,
    CREAK_THRESHOLD,
    `the watched member to reach at least CREAK_THRESHOLD ` +
      `(${CREAK_THRESHOLD}) of its capacity during this run, which is what ` +
      "puts it at the top of the ramp where breaking point is " +
      "(specs/statics.md)",
  );
  const step = Math.min(STEP, (top.load - bottom.load) / 2);
  assertGreaterThanOrEqual(
    step,
    NARROWEST,
    `two equal steps of at least ${NARROWEST} in utilization below ` +
      `${top.load.toFixed(3)} to be reached during this run, which is the ` +
      "span this point compares the ramp's rate over",
  );

  const nearest = (wanted: number): { load: number; colour: Rgb } =>
    readings.reduce((best, one) =>
      Math.abs(one.load - wanted) < Math.abs(best.load - wanted) ? one : best,
    );
  const high = top;
  const middle = nearest(top.load - step);
  const low = nearest(top.load - 2 * step);

  const lowerStep = middle.load - low.load;
  const upperStep = high.load - middle.load;
  assertGreaterThan(
    lowerStep,
    0,
    "three distinct loads to read the ramp at, which the run passes through",
  );
  assertLessThanOrEqual(
    upperStep,
    lowerStep * 1.1,
    `the step into breaking point (${low.load.toFixed(3)} to ` +
      `${middle.load.toFixed(3)} to ${high.load.toFixed(3)}) to be no wider ` +
      "in utilization than the step below it, which is what makes the two " +
      "comparable",
  );

  await h.capture(
    "breaking",
    "A member at breaking point, and the same member two equal steps below",
  );
  console.log(
    `gantry: ramp read at ${low.load.toFixed(3)} / ${middle.load.toFixed(3)} ` +
      `/ ${high.load.toFixed(3)} — the lower step moves the colour ` +
      `${apart(low.colour, middle.colour).toFixed(0)} of 441 and the step ` +
      `into breaking point ${apart(middle.colour, high.colour).toFixed(0)}`,
  );

  const lower = apart(low.colour, middle.colour);
  const upper = apart(middle.colour, high.colour);

  assertGreaterThan(
    upper,
    READS,
    `the member at ${high.load.toFixed(3)} of its capacity to be drawn ` +
      `plainly apart from the same member at ${middle.load.toFixed(3)}, ` +
      "since a member at breaking point stands out (specs/overview.md)",
  );
  assertGreaterThan(
    upper,
    lower,
    `the step into breaking point (${middle.load.toFixed(3)} to ` +
      `${high.load.toFixed(3)}, ${upper.toFixed(0)} of 441) to move the ` +
      `member's colour further than the equal step below it ` +
      `(${low.load.toFixed(3)} to ${middle.load.toFixed(3)}, ` +
      `${lower.toFixed(0)} of 441): the top of the ramp is not just another ` +
      "step along it (specs/overview.md)",
  );
});
