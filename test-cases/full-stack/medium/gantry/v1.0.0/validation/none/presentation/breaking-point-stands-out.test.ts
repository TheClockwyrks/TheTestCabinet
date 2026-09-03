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
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import {
  CREAK_THRESHOLD,
  HOIST_START,
  STAGE_H,
  STAGE_W,
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

/** How many points along a member are sampled for its colour. */
const SAMPLES = 5;

/** How near two samples must be to be the same colour, out of 441. */
const AGREES = 25;

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */
//
// An engineless build draws the yard through WebGL, so nothing here reads pixels
// off a 2D context: what a check reads is the page's own composited frame, taken
// with `page.screenshot` — the same picture `h.capture` writes as the review
// item's evidence. The PNG goes back INTO the page to be decoded, because the
// page carries an image decoder and this process carries none.
//
// ONLY THE POINTS THIS POINT READS COME BACK. The frame is photographed at a clip
// around the handful of stage points the members are sampled at, and the decode
// in the page answers those samples rather than the frame: a whole composited
// frame is two million pixels and eight megabytes of it crossing back out of the
// browser, once for every reading along the ramp, buys nothing the twenty samples
// do not already carry.
//
// A point is addressed in LOGICAL STAGE UNITS, the units `project` answers in
// and the units `specs/overview.md` lays the stage out in, and the canvas's own
// box on the page is what turns one into the other: the stage is fitted into it
// at one uniform scale, centred, exactly as that file states.

/** A colour read off the frame, each channel 0-255. */
type Rgb = readonly [number, number, number];

/** A point on the stage, in the logical units `project` answers in. */
interface StagePoint {
  x: number;
  y: number;
}

/** Where the stage sits inside the canvas, in the page's own pixels. */
interface StageFit {
  scale: number;
  originX: number;
  originY: number;
}

/** How far apart two colours are, on the 0-441 (`sqrt(3) * 255`) scale. */
function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Where the stage is fitted into the build's canvas, read once per page. */
async function stageFit(h: Harness): Promise<StageFit> {
  const box = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as { x: number; y: number; width: number; height: number } | null;
  assertTrue(
    box !== null,
    "a <canvas> on the page for the build to draw the yard in",
  );
  const fit = box!;
  const scale = Math.min(fit.width / STAGE_W, fit.height / STAGE_H);
  return {
    scale,
    originX: fit.x + (fit.width - STAGE_W * scale) / 2,
    originY: fit.y + (fit.height - STAGE_H * scale) / 2,
  };
}

/**
 * The colours the composited frame shows at each of `points`, in that order.
 *
 * The clip is the box those points fall in, so what is photographed and decoded
 * is the corner of the yard the members are drawn in rather than the whole
 * screen, and what crosses back out of the page is the samples themselves.
 */
async function readSamples(
  h: Harness,
  fit: StageFit,
  points: readonly StagePoint[],
): Promise<Rgb[]> {
  const on = points.map((point) => ({
    x: fit.originX + point.x * fit.scale,
    y: fit.originY + point.y * fit.scale,
  }));
  const pad = 2;
  const left = Math.max(0, Math.floor(Math.min(...on.map((p) => p.x)) - pad));
  const top = Math.max(0, Math.floor(Math.min(...on.map((p) => p.y)) - pad));
  const clip = {
    x: left,
    y: top,
    width: Math.max(1, Math.ceil(Math.max(...on.map((p) => p.x)) + pad) - left),
    height: Math.max(1, Math.ceil(Math.max(...on.map((p) => p.y)) + pad) - top),
  };
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await h.paintFrame();
  const png = (await h.page.screenshot({ type: "png", clip })).toString(
    "base64",
  );
  const wanted = on.map((p) => [p.x - clip.x, p.y - clip.y] as const);
  const read = (await h.page.evaluate(
    async ([b64, width, at]: [string, number, (readonly number[])[]]) => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      // The clip is asked for in the page's own pixels and answered in the
      // device's, so a page drawn at any device pixel ratio maps the same way.
      const ratio = image.width / width;
      return at.map(([x, y]) => {
        const px = Math.min(
          image.width - 1,
          Math.max(0, Math.round(x * ratio)),
        );
        const py = Math.min(
          image.height - 1,
          Math.max(0, Math.round(y * ratio)),
        );
        const i = (py * image.width + px) * 4;
        return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
      });
    },
    [png, clip.width, wanted] as [string, number, (readonly number[])[]],
  )) as number[][];
  return read.map((one) => [one[0]!, one[1]!, one[2]!] as const);
}

/** The `SAMPLES` points over the middle of a member's projected segment. */
function samplePoints(a: StagePoint, b: StagePoint): StagePoint[] {
  const points: StagePoint[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const t = 0.3 + (0.4 * i) / (SAMPLES - 1);
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return points;
}

/**
 * The colour a member is drawn in, from the samples read along its segment.
 *
 * The answer is the mean of the largest group of them that agree within
 * `AGREES`. A member is drawn in one colour along its length, so the samples
 * that landed on it agree; a sample that landed on something crossing in front
 * of it does not join that group.
 */
function memberColour(samples: readonly Rgb[]): Rgb | null {
  let best: Rgb[] = [];
  for (const sample of samples) {
    const group = samples.filter((other) => apart(sample, other) <= AGREES);
    if (group.length > best.length) best = [...group];
  }
  if (best.length * 2 <= SAMPLES) return null;
  return [
    best.reduce((sum, c) => sum + c[0], 0) / best.length,
    best.reduce((sum, c) => sum + c[1], 0) / best.length,
    best.reduce((sum, c) => sum + c[2], 0) / best.length,
  ];
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

  // Where each candidate is drawn. Nothing turns the arm, so this holds for the
  // whole run and each member is read at the same place at every load.
  const drawn = [];
  for (const [from, to] of CANDIDATES) {
    const a = await h.project(from.x, from.y, from.z);
    const b = await h.project(to.x, to.y, to.z);
    assertTrue(
      a.visible &&
        b.visible &&
        a.x >= 0 &&
        a.x < STAGE_W &&
        a.y >= 0 &&
        a.y < STAGE_H &&
        b.x >= 0 &&
        b.x < STAGE_W &&
        b.y >= 0 &&
        b.y < STAGE_H,
      `the member between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ` +
        `${to.y}, ${to.z}) to be drawn on the stage at this camera pose`,
    );
    drawn.push({ from, to, a, b });
  }

  // The stage points every reading is taken at. Nothing turns the arm, so they
  // are the same at every load and the clip they fall in is photographed once
  // per reading rather than the whole screen.
  const fit = await stageFit(h);
  const wanted = drawn.flatMap(({ a, b }) => samplePoints(a, b));

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
    const read = await readSamples(h, fit, wanted);
    for (const index of drawn.keys()) {
      const force = state.run.forces.find((f) => f.id === ids[index]);
      const colour = memberColour(
        read.slice(index * SAMPLES, (index + 1) * SAMPLES),
      );
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
