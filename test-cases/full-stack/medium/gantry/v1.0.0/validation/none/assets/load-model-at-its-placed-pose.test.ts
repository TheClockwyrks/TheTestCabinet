// assets/load-model-at-its-placed-pose — a placed load is drawn on its pad.
//
// specs/assets.md, "The models": "The game draws each model wherever its subject
// is: … and each load at its pose, waiting, hanging, or placed."
// specs/world.md, "Loads": "A placed load sits at exactly its target pose for
// the rest of the run."
//
// THE READING IS TWO RUNS OF THE SAME BUILD, ONE TICK APART FROM EACH OTHER IN
// NOTHING BUT THE LOAD'S PHASE. A run is alive while this is read — the clock in
// the readouts moves, the bob swings, the members recolor — so a before-and-
// after on one page could not tell the crate appearing on its pad from a run
// that simply ticked. specs/instrumentation.md fixes the way out: "Gantry uses
// no randomness anywhere, and a run advances only on its fixed tick, so the same
// structure and the same tape produce the same run, tick for tick, every time."
// So two pages are driven through the same ticks of the same run, and only one
// of them is told to set the load down. Everything either page draws that is not
// the load is then IDENTICAL, and the whole frame can be held to that.
//
// POSING THE PHASE CHANGES NOTHING THE SIMULATION READS: a waiting load and a
// placed load both hang from nothing and are solid to nothing (specs/world.md,
// specs/collisions), so the two runs stay tick-for-tick the same.
//
// WHAT IS ASSERTED. The picture inside the class box AT THE TARGET POSE differs
// between the two, and the ring of yard around that box is byte-identical: the
// placed load is drawn at exactly its target pose and not beside it. Where the
// box is on the stage is the build's own answer, through `project`
// (specs/instrumentation.md).
//
// THE RING IS THE YARD AROUND THE PAD, NOT THE WHOLE FRAME. specs/ui.md fixes
// what the run screen's readouts show, but a build is free to put more beside
// them — how many loads are placed, say — and holding the whole frame still
// would fail such a build for a flourish the specification neither asks for nor
// forbids. Where the load itself is drawn is not something a build is free
// about, so the ring is what is held still, and it is checked to stand clear of
// the load's starting pose so that the crate LEAVING that pose is not read as
// the crate arriving beside this one.
//
// THE MARGIN IS AN HONEST TOLERANCE: the models "fill their class boxes" and the
// figures are "the intent, not a tolerance" (specs/assets.md), and a build draws
// the pad and its yaw mark under a placed load as well, so a few logical pixels
// fall outside the mathematical hull.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_START,
  LOAD_CLASS_DIMENSIONS,
  STAGE_H,
  STAGE_W,
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

/** The one load: a crate that starts well clear of the crane and its pad. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 8, y: 2, z: -4, yaw: 0 };
const TARGET: LoadPose = { x: -2, y: 2, z: 8, yaw: 0 };

/** Enough tape for a run to start and keep running while the frame is read. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 4, rate: HOIST_MAX_RATE / 8 },
    ],
  },
];

/** The tick both runs are read at, past the run's first. */
const READ_AT = 20;

/** Slack around a projected hull, as a share of the box's own drawn size. */
const MARGIN_SHARE = 0.25;

/** How far past that slack the yard is held still, in the same units. */
const RING_SHARE = 2;

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
          `every corner of the class box at (${pose.x}, ${pose.y}, ${pose.z}) ` +
            "to be drawn on the stage at the start camera pose, so this point " +
            "has a picture to read (specs/instrumentation.md)",
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

/** Stand one page up on the same run, and leave it one tick short of the read. */
async function poseRun(harness: Harness): Promise<void> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await harness.debug.addLoad(CLASS, MASS, START.x, START.y, START.z, START.yaw);
  await harness.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, TARGET.yaw);
  await standMinimalCrane(harness);
  await poseTape(harness, TAPE);
  await startRun(harness);
  const state = await runTicks(harness, READ_AT);
  assertEqual(
    state.run.phase,
    "running",
    `the run to still be running at tick ${READ_AT}, which is where this ` +
      "point reads both pages",
  );
  assertEqual(
    state.run.loads[0]?.phase,
    "waiting",
    "the load to be waiting on both pages before either is told to set it down",
  );
}

/** The canvas's place on the page, so a logical rectangle names a real one. */
async function canvasFit(harness: Harness): Promise<Rect> {
  const fit = (await harness.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as Rect | null;
  assertTrue(fit !== null, "a <canvas> on the page for the build to draw in");
  return fit!;
}

let waiting: Harness;
let placed: Harness;

beforeEach(async () => {
  waiting = await createHarness();
  placed = await createHarness();
});

afterEach(async () => {
  await waiting.dispose();
  await placed.dispose();
});

it("draws a placed load inside its class box at its target pose", async () => {
  await poseRun(waiting);
  await poseRun(placed);

  const onPad = await hull(waiting, TARGET);
  const atStart = await hull(waiting, START);

  // The ring of yard around the pad, which setting the load down may not reach.
  const span = Math.max(onPad.width, onPad.height);
  const margin = MARGIN_SHARE * span;
  const ring = RING_SHARE * span;
  const near = {
    left: onPad.x - margin,
    right: onPad.x + onPad.width + margin,
    top: onPad.y - margin,
    bottom: onPad.y + onPad.height + margin,
  };
  const far = {
    left: Math.max(0, onPad.x - ring),
    right: Math.min(STAGE_W, onPad.x + onPad.width + ring),
    top: Math.max(0, onPad.y - ring),
    bottom: Math.min(STAGE_H, onPad.y + onPad.height + ring),
  };
  assertTrue(
    atStart.x > far.right ||
      atStart.x + atStart.width < far.left ||
      atStart.y > far.bottom ||
      atStart.y + atStart.height < far.top,
    "the load's starting pose to be drawn clear of the ring of yard around " +
      "its pad, so the crate leaving one is never read as the crate arriving " +
      "beside the other — the two poses this point uses are far apart",
  );
  const outside: { where: string; rect: Rect }[] = [
    {
      where: "left of the pad",
      rect: { x: far.left, y: far.top, width: near.left - far.left, height: far.bottom - far.top },
    },
    {
      where: "right of the pad",
      rect: { x: near.right, y: far.top, width: far.right - near.right, height: far.bottom - far.top },
    },
    {
      where: "above the pad",
      rect: { x: near.left, y: far.top, width: near.right - near.left, height: near.top - far.top },
    },
    {
      where: "below the pad",
      rect: { x: near.left, y: near.bottom, width: near.right - near.left, height: far.bottom - near.bottom },
    },
  ];
  assertEqual(
    outside.filter(({ rect }) => rect.width >= 1 && rect.height >= 1).length,
    4,
    "the four bands of yard around the pad, which this point needs the pad's " +
      "box to stand clear of the stage's edges for",
  );

  const fits = { waiting: await canvasFit(waiting), placed: await canvasFit(placed) };
  const shot = async (harness: Harness, fit: Rect, rect: Rect): Promise<Buffer> => {
    const sx = fit.width / STAGE_W;
    const sy = fit.height / STAGE_H;
    return harness.page.screenshot({
      clip: {
        x: fit.x + Math.max(0, rect.x) * sx,
        y: fit.y + Math.max(0, rect.y) * sy,
        width: Math.max(1, rect.width * sx),
        height: Math.max(1, rect.height * sy),
      },
    });
  };

  // The one difference between the two pages: on one, the load is set down.
  await placed.debug.setLoadPhase(0, "placed");
  await placed.advance(1);
  await waiting.advance(1);

  const settled = await placed.snapshot();
  assertEqual(
    settled.run.loads[0]?.phase,
    "placed",
    "the phase the posed load holds, which this point is about " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    settled.run.loads[0]?.pos.x,
    TARGET.x,
    "the placed load's lift point, which sits at exactly its target pose " +
      "(specs/world.md)",
  );

  assertTrue(
    !(await shot(waiting, fits.waiting, onPad)).equals(
      await shot(placed, fits.placed, onPad),
    ),
    "the picture inside the class box at the target pose " +
      `(${TARGET.x}, ${TARGET.y}, ${TARGET.z}) to differ once the load is ` +
      "placed, since the game draws each load at its pose and a placed load " +
      "sits at exactly its target pose (specs/assets.md, specs/world.md)",
  );

  const spilled: string[] = [];
  for (const band of outside) {
    const same = (await shot(waiting, fits.waiting, band.rect)).equals(
      await shot(placed, fits.placed, band.rect),
    );
    if (!same) spilled.push(band.where);
  }
  assertEqual(
    spilled.join(", "),
    "",
    `the yard from ${margin.toFixed(1)} to ${ring.toFixed(1)} logical pixels ` +
      "around the pad, which setting the load down may not change: a placed " +
      "load sits at exactly its target pose and is drawn there rather than " +
      "beside it (specs/assets.md, specs/world.md)",
  );

  await placed.capture("placed", "The placed load on its pad");
});
