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
// between the two, and the ring of yard around that box is pixel-identical: the
// placed load is drawn at exactly its target pose and not beside it. Where the
// box is on the stage is the build's own answer, through `project`
// (specs/instrumentation.md).
//
// ONE PICTURE PER PAGE, READ FIVE TIMES. Each page is photographed once and the
// five regions — the pad and the four bands of yard around it — are compared
// inside those two pictures rather than re-photographed one region at a time. A
// clipped screenshot is a round trip into the browser and a fresh composite, and
// ten of them cost this point more than everything else it does put together,
// for a reading no different from indexing the frame that was already taken.
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
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertEqual, assertTrue } from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_START,
  LOAD_CLASS_DIMENSIONS,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  createHarness,
  emptyYard,
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

/**
 * The tick both runs are read at, past the run's first.
 *
 * Far enough in that the run is plainly under way — the tape's step is live, the
 * hoist is paying out and the clock has moved — and no further, because what this
 * point compares is two pages at the SAME tick, and every tick beyond the first is
 * as good as the next for that.
 */
const READ_AT = 6;

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
  await emptyYard(harness);
  await harness.debug.addLoad(
    CLASS,
    MASS,
    START.x,
    START.y,
    START.z,
    START.yaw,
  );
  await harness.debug.setLoadTarget(
    0,
    TARGET.x,
    TARGET.y,
    TARGET.z,
    TARGET.yaw,
  );
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

/** One page's frame, and the mapping from a logical stage point into it. */
interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** The canvas's place on the page, in CSS pixels. */
  fit: Rect;
  /** Image pixels per CSS pixel. */
  scale: number;
}

/**
 * Photograph a page once, with the canvas's place on it.
 *
 * The stage is logical (`STAGE_W` by `STAGE_H`) and the canvas is wherever the
 * build's own fit put it, so a logical rectangle names a real one only through
 * that rectangle and the ratio between CSS pixels and the image's own.
 */
async function picture(harness: Harness): Promise<Picture> {
  const seen = (await harness.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return {
      fit: { x: at.x, y: at.y, width: at.width, height: at.height },
      cssWidth: window.innerWidth,
    };
  })) as { fit: Rect; cssWidth: number } | null;
  assertTrue(seen !== null, "a <canvas> on the page for the build to draw in");
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await harness.paintFrame();
  const png = await harness.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return {
    width: image.width,
    height: image.height,
    data,
    fit: seen!.fit,
    scale: image.width / seen!.cssWidth,
  };
}

/**
 * Where a logical stage rectangle lands in one picture, in image pixels.
 *
 * It FAILS the item if the rectangle does not land inside the picture at all. A
 * region read off the edge of a frame is a comparison of nothing with nothing,
 * which would answer "identical" to every question this point asks.
 */
function region(shot: Picture, rect: Rect, where: string): Rect {
  const sx = (shot.fit.width / STAGE_W) * shot.scale;
  const sy = (shot.fit.height / STAGE_H) * shot.scale;
  const at = {
    x: Math.round(
      (shot.fit.x + Math.max(0, rect.x) * (shot.fit.width / STAGE_W)) *
        shot.scale,
    ),
    y: Math.round(
      (shot.fit.y + Math.max(0, rect.y) * (shot.fit.height / STAGE_H)) *
        shot.scale,
    ),
    width: Math.max(1, Math.round(rect.width * sx)),
    height: Math.max(1, Math.round(rect.height * sy)),
  };
  assertTrue(
    at.x >= 0 &&
      at.y >= 0 &&
      at.x + at.width <= shot.width &&
      at.y + at.height <= shot.height,
    `the ${where} to lie inside the frame the page was photographed as, ` +
      `which is ${shot.width} by ${shot.height} pixels: it maps to ` +
      `(${at.x}, ${at.y}) ${at.width} by ${at.height}`,
  );
  return at;
}

/**
 * Whether two pictures are identical over one logical rectangle of the stage.
 *
 * Pixel for pixel, with no tolerance: what the two pages draw outside the pad is
 * the same run at the same tick, so anything at all that differs there is the
 * load having been drawn somewhere it does not belong.
 */
function samePixels(
  a: Picture,
  b: Picture,
  rect: Rect,
  where: string,
): boolean {
  const one = region(a, rect, where);
  const two = region(b, rect, where);
  if (one.width !== two.width || one.height !== two.height) return false;
  for (let row = 0; row < one.height; row += 1) {
    const ay = one.y + row;
    const by = two.y + row;
    for (let column = 0; column < one.width; column += 1) {
      const ax = one.x + column;
      const bx = two.x + column;
      const i = (ay * a.width + ax) * 4;
      const j = (by * b.width + bx) * 4;
      if (
        a.data[i] !== b.data[j] ||
        a.data[i + 1] !== b.data[j + 1] ||
        a.data[i + 2] !== b.data[j + 2] ||
        a.data[i + 3] !== b.data[j + 3]
      ) {
        return false;
      }
    }
  }
  return true;
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
      rect: {
        x: far.left,
        y: far.top,
        width: near.left - far.left,
        height: far.bottom - far.top,
      },
    },
    {
      where: "right of the pad",
      rect: {
        x: near.right,
        y: far.top,
        width: far.right - near.right,
        height: far.bottom - far.top,
      },
    },
    {
      where: "above the pad",
      rect: {
        x: near.left,
        y: far.top,
        width: near.right - near.left,
        height: near.top - far.top,
      },
    },
    {
      where: "below the pad",
      rect: {
        x: near.left,
        y: near.bottom,
        width: near.right - near.left,
        height: far.bottom - near.bottom,
      },
    },
  ];
  assertEqual(
    outside.filter(({ rect }) => rect.width >= 1 && rect.height >= 1).length,
    4,
    "the four bands of yard around the pad, which this point needs the pad's " +
      "box to stand clear of the stage's edges for",
  );

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

  // One frame off each page, and every region below is read inside them.
  const frames = {
    waiting: await picture(waiting),
    placed: await picture(placed),
  };

  assertTrue(
    !samePixels(
      frames.waiting,
      frames.placed,
      onPad,
      "class box at the target pose",
    ),
    "the picture inside the class box at the target pose " +
      `(${TARGET.x}, ${TARGET.y}, ${TARGET.z}) to differ once the load is ` +
      "placed, since the game draws each load at its pose and a placed load " +
      "sits at exactly its target pose (specs/assets.md, specs/world.md)",
  );

  const spilled: string[] = [];
  for (const band of outside) {
    if (!samePixels(frames.waiting, frames.placed, band.rect, band.where)) {
      spilled.push(band.where);
    }
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
