// assets/load-model-at-its-hanging-pose — an attached load is drawn where the
// run says it hangs, not left behind where it started.
//
// specs/assets.md, "The models": "The game draws each model wherever its subject
// is: … the hook at the bob turned to the grip's yaw, … and each load at its
// pose, waiting, hanging, or placed."
// specs/instrumentation.md: `setLoadPhase` to `"attached"` "hangs that load on
// the hook exactly as a successful `attach` leaves it", and a snapshot's
// `run.loads[i].pos` is the pose the run holds that load at.
//
// THE POSE IS READ OFF THE RUN, NOT GUESSED. Where a hanging load is depends on
// where the bob is, which depends on the tape, the pendulum and the tick — so
// this point asks the build where the load is (`run.loads[0].pos`) and then asks
// where that is drawn (`project`), and holds the picture to that. A validator
// that computed the hanging pose itself would be grading its own pendulum.
//
// THE READING IS TWO RUNS OF THE SAME BUILD, DIFFERING ONLY IN THE ATTACHMENT. A
// run is alive while this is read — the clock in the readouts moves and the bob
// settles — so a before-and-after on one page could not tell the crate arriving
// at the hook from a run that simply ticked. specs/instrumentation.md fixes the
// way out: "Gantry uses no randomness anywhere, and a run advances only on its
// fixed tick, so the same structure and the same tape produce the same run, tick
// for tick, every time." Two pages are driven through the same ticks of the same
// run and only one of them is told to hang the load.
//
// WHY THE READING IS A PIXEL COUNT AND NOT A BYTE COMPARISON. Hanging a load
// legitimately changes the picture away from the load: the members are "colored
// by utilization during a run" (specs/ui.md, specs/assets.md), so the weight now
// on the hook reshades the crane. A validator that held the yard around the hook
// still would be failing a build for doing exactly what the specification asks.
// So the two frames are compared pixel by pixel with a threshold that a reshade
// does not cross — a change of `THRESHOLD` summed across the three channels —
// and what is asserted is that a large part of the load's own box changed, which
// is what a model being drawn there looks like and what a shift along a color
// ramp cannot produce.
//
// AND BOTH POSES ARE READ, because that is the requirement in one sentence: the
// load is drawn where the run reports it AND is gone from where it started. The
// starting pose is put far from the crane, so nothing but the crate can change
// there.
//
// THE BOB IS PARKED BEFORE THE READING. The tape drives the trolley out and the
// hoist down, which leaves the bob swinging; it is then put straight below the
// pivot at the cable's own length, at rest, which is where the constraint holds
// it. That is a precondition posed through the surface, not an outcome: the run
// goes on ticking under its own rules from there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  HOIST_MAX_RATE,
  LOAD_CLASS_DIMENSIONS,
  SLEW_MAX_RATE,
  STAGE_W,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type LoadPose,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The one load: site 1's own crate, started far from the crane and the hook. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 0, y: 2, z: 11, yaw: 0 };

/**
 * The tape: the trolley out along the rail and the hoist down, so the hook hangs
 * in clear air well outboard of the tower, and then a slew so slow that the run
 * keeps running while the frame is read without the yard moving under it.
 */
const TROLLEY_AT = 3.5;
const HOIST_AT = 1.5;
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "trolley", target: TROLLEY_AT, rate: TROLLEY_MAX_RATE },
      { axis: "hoist", target: HOIST_AT, rate: HOIST_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [{ axis: "slew", target: 180, rate: SLEW_MAX_RATE / 1000 }],
  },
];

/** How long the first step is given, and the settling after the bob is parked. */
const MAX_TICKS = 900;
const SETTLE = 4;

/**
 * How different two pixels must be to count, summed over the three channels.
 *
 * Well above a step along the utilization ramp and well below the difference
 * between the yard and a crate drawn over it.
 */
const THRESHOLD = 90;

/**
 * How much of the box's projected extent a model drawn there has to change.
 *
 * A box's silhouette covers most of its own bounding rectangle, and the
 * reference build changes about `0.45` of it; a fifth is a floor no reshade of a
 * cable or a member crossing the box can reach, with room for a model that fills
 * its class box less completely than the reference's does.
 */
const COVERAGE = 0.2;

/** A rectangle of the stage, in logical units. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a pose's class box lands on the stage, as the build projects it. */
async function hull(harness: Harness, pose: LoadPose): Promise<Rect> {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const radians = (pose.yaw * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [-size.x / 2, size.x / 2]) {
    for (const dz of [-size.z / 2, size.z / 2]) {
      for (const dy of [-size.y, 0]) {
        const at = await harness.project(
          pose.x + dx * cos - dz * sin,
          pose.y + dy,
          pose.z + dx * sin + dz * cos,
        );
        assertTrue(
          at.visible,
          `every corner of the class box at (${pose.x.toFixed(2)}, ` +
            `${pose.y.toFixed(2)}, ${pose.z.toFixed(2)}) to be drawn on the ` +
            "stage at the start camera pose, so this point has a picture to " +
            "read (specs/instrumentation.md)",
        );
        left = Math.min(left, at.x);
        right = Math.max(right, at.x);
        top = Math.min(top, at.y);
        bottom = Math.max(bottom, at.y);
      }
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Stand one page up on the same run, with the bob parked and at rest. */
async function poseRun(harness: Harness): Promise<void> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await harness.debug.addLoad(CLASS, MASS, START.x, START.y, START.z, START.yaw);
  await standMinimalCrane(harness);
  await poseTape(harness, TAPE);
  await startRun(harness);

  let state = await runTicks(harness, 1);
  for (let ran = 1; ran < MAX_TICKS && state.run.stepIndex < 1; ran += 1) {
    state = await runTicks(harness, 1);
  }
  assertEqual(
    state.run.stepIndex,
    1,
    `the tape's first step to complete within ${MAX_TICKS} ticks, so the hook ` +
      "stands out along the rail before this point reads the frame",
  );
  assertEqual(state.run.phase, "running", "the run while the frame is read");

  // The bob straight below the pivot at the cable's own length, at rest: the
  // position the constraint holds, so it stays where it is put.
  await harness.debug.setBob(
    state.run.pivot.x,
    state.run.pivot.y - state.run.axes.hoist.value,
    state.run.pivot.z,
  );
  await harness.debug.setBobVelocity(0, 0, 0);
  await runTicks(harness, SETTLE);
}

/**
 * How many pixels of each named rectangle the two frames differ in, past
 * {@link THRESHOLD}.
 *
 * The two PNGs go back INTO a page to be read: the frames are the browser's own
 * composited output and the page is the one place that can decode them, and one
 * crossing carries both pictures and brings back two numbers rather than two
 * million.
 */
async function differing(
  harness: Harness,
  frames: readonly [string, string],
  rects: readonly Rect[],
  threshold: number,
): Promise<number[]> {
  return (await harness.page.evaluate(
    async ([left, right, boxes, limit, stageWidth]) => {
      const read = async (encoded: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(encoded), (one) => one.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const a = await read(left as string);
      const b = await read(right as string);
      const windows = boxes as { x: number; y: number; width: number; height: number }[];
      const counts = windows.map(() => 0);
      // The frame is the whole viewport, which the harness fits to the logical
      // stage, so a logical rectangle is scaled by whatever the picture came
      // back at.
      const scale = a.width / (stageWidth as number);
      for (const [index, box] of windows.entries()) {
        const x0 = Math.max(0, Math.floor(box.x * scale));
        const x1 = Math.min(a.width - 1, Math.ceil((box.x + box.width) * scale));
        const y0 = Math.max(0, Math.floor(box.y * scale));
        const y1 = Math.min(a.height - 1, Math.ceil((box.y + box.height) * scale));
        let count = 0;
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            const at = (y * a.width + x) * 4;
            const delta =
              Math.abs(a.data[at]! - b.data[at]!) +
              Math.abs(a.data[at + 1]! - b.data[at + 1]!) +
              Math.abs(a.data[at + 2]! - b.data[at + 2]!);
            if (delta > (limit as number)) count += 1;
          }
        }
        counts[index] = count;
      }
      return counts;
    },
    [frames[0], frames[1], rects, threshold, STAGE_W] as const,
  )) as number[];
}

let free: Harness;
let hanging: Harness;

beforeEach(async () => {
  free = await createHarness();
  hanging = await createHarness();
});

afterEach(async () => {
  await free.dispose();
  await hanging.dispose();
});

it("draws an attached load at the pose the run reports and not at its starting pose", async () => {
  await poseRun(free);
  await poseRun(hanging);

  // The one difference between the two pages: on one, the load is on the hook.
  await hanging.debug.setLoadPhase(0, "attached");
  await hanging.advance(1);
  await free.advance(1);

  const hung = await hanging.snapshot();
  const loose = await free.snapshot();
  assertEqual(
    hung.run.loads[0]?.phase,
    "attached",
    "the phase the posed load holds, which this point is about " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    loose.run.loads[0]?.phase,
    "waiting",
    "the load on the page that was told nothing, so the two pages differ in " +
      "the attachment alone",
  );
  assertEqual(
    hung.run.phase,
    "running",
    "the run on the page carrying the load, which must still be running for " +
      "the hanging pose to be the one drawn",
  );

  const at = hung.run.loads[0]!;
  const onHook = await hull(hanging, {
    x: at.pos.x,
    y: at.pos.y,
    z: at.pos.z,
    yaw: at.yaw,
  });
  const atStart = await hull(hanging, START);
  assertTrue(
    atStart.x > onHook.x + onHook.width ||
      atStart.x + atStart.width < onHook.x ||
      atStart.y > onHook.y + onHook.height ||
      atStart.y + atStart.height < onHook.y,
    "the load's starting pose and its hanging pose to be drawn apart, so the " +
      "two readings this point takes are of two different places",
  );

  const frames: [string, string] = [
    (await free.page.screenshot()).toString("base64"),
    (await hanging.page.screenshot()).toString("base64"),
  ];
  const [changedOnHook, changedAtStart] = await differing(
    hanging,
    frames,
    [onHook, atStart],
    THRESHOLD,
  );

  const wantedOnHook = Math.round(COVERAGE * onHook.width * onHook.height);
  assertGreaterThanOrEqual(
    changedOnHook ?? 0,
    wantedOnHook,
    "the pixels that changed inside the class box at the pose the run reports " +
      `for the attached load — (${at.pos.x.toFixed(2)}, ` +
      `${at.pos.y.toFixed(2)}, ${at.pos.z.toFixed(2)}) — since the game draws ` +
      "each load at its pose and an attached load hangs from the hook " +
      "(specs/assets.md)",
  );

  const wantedAtStart = Math.round(COVERAGE * atStart.width * atStart.height);
  assertGreaterThanOrEqual(
    changedAtStart ?? 0,
    wantedAtStart,
    "the pixels that changed inside the class box at the load's starting pose " +
      `(${START.x}, ${START.y}, ${START.z}), since a load that hangs from the ` +
      "hook is no longer drawn where it started (specs/assets.md)",
  );

  await hanging.capture("hanging", "The attached load hanging from the hook");
});
