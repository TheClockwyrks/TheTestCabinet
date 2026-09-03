// assets/hook-model-at-the-bob — the hook block is drawn where the bob is, so it
// goes where the bob goes.
//
// specs/assets.md § The models says where the model goes: "The game draws each
// model wherever its subject is: … the hook at the bob turned to the grip's yaw
// …". specs/state.md gives the bob as the run's own reading, `run.bob.pos`, and
// specs/rigging.md hangs it from the trolley on the hoist cable, so the block's
// place on the stage is wherever the build says its bob currently is.
//
// TWO PLACES, because one cannot tell a block drawn at the bob from a block drawn
// at the trolley, at the track's origin, or at any other point that happens to
// coincide with the bob in a single pose. The first is the bob hanging straight
// under the carriage part-way along the track; the second is the bob swung out
// from a carriage at the far end, so it shares neither its position, its point on
// the track, nor the vertical under either of them.
//
// EACH POSE IS SETTLED BEFORE IT IS READ. `setBob` places the bob and `setAxis`
// sets the hoist to exactly the pivot-to-bob distance, so the cable is already
// satisfied and the frame that draws it moves nothing; the box is then centered
// on the bob the run itself reports, not on the figure this file asked for.
//
// WHERE THE BLOCK IS DRAWN IS READ BY SERVING A DIFFERENT MODEL UNDER ITS FILE.
// Moving the bob moves the cable with it and turns the run's readouts over, so
// the difference between two bob poses says nothing about the block alone. Two
// pages of the same build, posed identically, served the same in every respect
// but the bytes under `assets/models/hook.glb`, differ in exactly the pixels the
// hook model draws.
//
// THE WORLD IS THE CRANE ALONE: no loads, no obstacles, and a tape of one grip
// move, the only axis whose motion "applies no force to anything".
//
// ONE PICTURE PER PAGE PER POSE. Both readings a pose takes — that the box around
// the bob changed and that nothing outside it did — are of the same still frame,
// so each page is photographed once per pose and the box and the four bands
// around it are counted over those two frames inside the page. A composited frame
// off a software renderer is the expensive thing here, and ten of them per pose
// read exactly what two of them read. The `project` calls that place the box go
// the same way: eight corners in one crossing, through the build's own
// `window.__gantry` handle, which is the surface `specs/instrumentation.md`
// exposes and the surface `Harness.project` itself calls.

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertTrue, fail } from "../assert";
import { GRIP_MAX_RATE, STAGE_H, STAGE_W } from "../constants";
import {
  HANDLE,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type Projected,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** The subject's model, and the model served in its place. */
const SUBJECT = "hook";
const STAND_IN = "trolley";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/**
 * The two poses: a carriage part-way along the track with the bob hanging
 * straight under it, and the carriage at the far end with the bob swung out
 * thirty degrees, at the same cable length either way.
 */
const CABLE = 3;
const POSES: readonly { name: string; trolley: number; bob: Vec3 }[] = [
  { name: "hanging under the carriage", trolley: 2, bob: { x: 2, y: 1, z: 0 } },
  {
    name: "swung out from the carriage",
    trolley: 4,
    bob: {
      x: 4 + CABLE * Math.sin(Math.PI / 6),
      y: 4 - CABLE * Math.cos(Math.PI / 6),
      z: 0,
    },
  },
];

/**
 * How far around the bob the block's drawing is held.
 *
 * specs/assets.md sizes the hook "about `0.6 x 1 x 0.6` units" and says of the
 * part figures that they "are the intent, not a tolerance", so the box reaches
 * two units each way — room for any block a build sculpts to that intent, and for
 * the larger stand-in drawn in its place, while still leaving the carriage the
 * cable's three units above it outside.
 */
const HALF = 2;

/** Slack around the projected box before the stage must be untouched. */
const BAND_MARGIN = 8;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let served: Harness;
let substituted: Harness | null = null;
let context: BrowserContext | null = null;

beforeEach(async () => {
  served = await createHarness();
});

afterEach(async () => {
  if (context !== null) await context.unroute("**/*").catch(() => undefined);
  context = null;
  if (substituted !== null) await substituted.dispose();
  substituted = null;
  await served.dispose();
});

it("draws the hook at the bob, wherever the bob stands", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  await standCrane(served);
  context = served.page.context();
  await context.route("**/*", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.length === subject.length && body.equals(subject)) {
      await route.fulfill({ response, body: standIn });
      return;
    }
    await route.fulfill({ response, body });
  });
  substituted = await createHarness();
  await standCrane(substituted);

  for (const pose of POSES) {
    const at = await poseBob(served, pose);
    await poseBob(substituted, pose);

    const region = await boxRegion(served, at);
    const bands = surrounding(region);
    const before = await frameOf(served);
    const after = await frameOf(substituted);
    const changed = await countChanged(served, before, after, [
      region,
      ...bands.map((band) => band.rect),
    ]);

    const spilled = bands
      .filter((_, index) => changed[index + 1]! > 0)
      .map((band) => band.where);
    if (spilled.length > 0) {
      fail(
        `the hook model drawn within ${HALF} units of the bob, ` +
          `(${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}) with ` +
          `the bob ${pose.name}, so serving other bytes under ` +
          `assets/models/${SUBJECT}.glb changes nothing elsewhere on the ` +
          "stage (specs/assets.md)",
        `the stage changed ${spilled.join(", ")} as well, so the block is ` +
          "drawn somewhere other than at the bob",
      );
    }

    assertTrue(
      changed[0]! > 0,
      `the hook model to be drawn at the bob with the bob ${pose.name}, at ` +
        `(${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}) ` +
        "(specs/assets.md)",
    );
  }

  await served.capture("hook", "The hook at the bob");
});

/** A model specs/assets.md requires the build to have produced and committed. */
function committedModel(name: string): Buffer {
  try {
    return readFileSync(join(WORKSPACE, "assets", "models", `${name}.glb`));
  } catch {
    return fail(
      `a produced ${name} model committed at assets/models/${name}.glb, which ` +
        "specs/assets.md requires the build to produce with `voxel` and commit",
      "no such file in the build's tree",
    );
  }
}

/** The isolated world this point is about: one crane, running, nothing else. */
async function standCrane(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
}

/** Pose the carriage and the bob, and answer where the run says the bob is. */
async function poseBob(
  h: Harness,
  pose: { name: string; trolley: number; bob: Vec3 },
): Promise<Vec3> {
  await h.debug.setAxis("trolley", pose.trolley);
  await h.debug.setAxis("hoist", CABLE);
  await h.debug.setBob(pose.bob.x, pose.bob.y, pose.bob.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  const gap = Math.hypot(
    run.bob.pos.x - pose.bob.x,
    run.bob.pos.y - pose.bob.y,
    run.bob.pos.z - pose.bob.z,
  );
  if (gap > 0.25) {
    fail(
      `the bob to stay within a quarter unit of (${pose.bob.x.toFixed(2)}, ` +
        `${pose.bob.y.toFixed(2)}, ${pose.bob.z.toFixed(2)}) on the tick ` +
        "after it is posed there on a cable of exactly that length, so this " +
        "point reads a block standing still (specs/rigging.md)",
      `it stands ${gap.toFixed(3)} away`,
    );
  }
  return run.bob.pos;
}

/**
 * Where the build itself says a box around `at` is drawn, in logical units.
 *
 * The eight corners go in one crossing, through the same `project` operation
 * `Harness.project` calls: one reading per corner either way.
 */
async function boxRegion(h: Harness, at: Vec3): Promise<Rect> {
  const corners: [number, number, number][] = [];
  for (const dx of [-HALF, HALF]) {
    for (const dy of [-HALF, HALF]) {
      for (const dz of [-HALF, HALF]) {
        corners.push([at.x + dx, at.y + dy, at.z + dz]);
      }
    }
  }
  const drawn = (await h.page.evaluate(
    ([handle, points]: [string, [number, number, number][]]) => {
      const api = (
        window as unknown as Record<
          string,
          { project(x: number, y: number, z: number): unknown }
        >
      )[handle]!;
      return points.map(([x, y, z]) => api.project(x, y, z));
    },
    [HANDLE, corners] as [string, [number, number, number][]],
  )) as Projected[];

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [index, on] of drawn.entries()) {
    const [x, y, z] = corners[index]!;
    assertTrue(
      on.visible,
      `the corner (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) of the ` +
        "block's box to be drawn on the stage at the start camera pose, so " +
        "this point has a picture to read (specs/instrumentation.md)",
    );
    left = Math.min(left, on.x);
    right = Math.max(right, on.x);
    top = Math.min(top, on.y);
    bottom = Math.max(bottom, on.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The four bands of stage outside that extent, with a margin. */
function surrounding(region: Rect): { where: string; rect: Rect }[] {
  const left = region.x - BAND_MARGIN;
  const right = region.x + region.width + BAND_MARGIN;
  const top = region.y - BAND_MARGIN;
  const bottom = region.y + region.height + BAND_MARGIN;
  return [
    { where: "left of it", rect: { x: 0, y: 0, width: left, height: STAGE_H } },
    {
      where: "right of it",
      rect: { x: right, y: 0, width: STAGE_W - right, height: STAGE_H },
    },
    {
      where: "above it",
      rect: { x: left, y: 0, width: right - left, height: top },
    },
    {
      where: "below it",
      rect: {
        x: left,
        y: bottom,
        width: right - left,
        height: STAGE_H - bottom,
      },
    },
  ].filter(({ rect }) => rect.width >= 1 && rect.height >= 1);
}

/** One page's whole composited frame of the yard, and where the stage sits. */
interface Picture {
  png: string;
  width: number;
  scale: number;
  originX: number;
  originY: number;
}

/**
 * The canvas the build draws in, photographed whole.
 *
 * The clip is the canvas's own box, so the picture is the yard and nothing of the
 * page around it, and the stage is fitted inside it "at one uniform scale,
 * centred" (specs/overview.md) — which is what turns a logical stage rectangle
 * into pixels of this picture.
 */
async function frameOf(h: Harness): Promise<Picture> {
  const box = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as Rect | null;
  assertTrue(box !== null, "a <canvas> on the page for the build to draw in");
  const fit = box!;
  const clip = {
    x: fit.x,
    y: fit.y,
    width: Math.max(1, fit.width),
    height: Math.max(1, fit.height),
  };
  const scale = Math.min(fit.width / STAGE_W, fit.height / STAGE_H);
  // One held frame first; see `paint-gate.js`.
  await h.paintFrame();
  return {
    png: (await h.page.screenshot({ type: "png", clip })).toString("base64"),
    width: clip.width,
    scale,
    originX: (fit.width - STAGE_W * scale) / 2,
    originY: (fit.height - STAGE_H * scale) / 2,
  };
}

/**
 * How many pixels of each region differ between the two pictures.
 *
 * The decode happens in the page because the page carries an image decoder and
 * this process carries none, and the two pictures go in together so that only the
 * counts come back out.
 */
async function countChanged(
  h: Harness,
  before: Picture,
  after: Picture,
  regions: readonly Rect[],
): Promise<number[]> {
  assertTrue(
    before.width === after.width,
    "the two pages to draw the yard at the same size, so a region of the " +
      "stage is the same pixels in both",
  );
  const at = regions.map((rect) => [
    before.originX + rect.x * before.scale,
    before.originY + rect.y * before.scale,
    before.originX + (rect.x + rect.width) * before.scale,
    before.originY + (rect.y + rect.height) * before.scale,
  ]);
  const counts = (await h.page.evaluate(
    async ([one, two, width, boxes]: [string, string, number, number[][]]) => {
      const pixelsOf = async (b64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${b64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return {
          w: image.width,
          h: image.height,
          d: context.getImageData(0, 0, image.width, image.height).data,
        };
      };
      const a = await pixelsOf(one);
      const b = await pixelsOf(two);
      if (a.w !== b.w || a.h !== b.h) return null;
      // The clip is asked for in the page's own pixels and answered in the
      // device's, so a page drawn at any device pixel ratio maps the same way.
      const ratio = a.w / width;
      return boxes.map(([x0, y0, x1, y1]) => {
        let changed = 0;
        const left = Math.max(0, Math.floor(x0! * ratio));
        const right = Math.min(a.w, Math.ceil(x1! * ratio));
        const top = Math.max(0, Math.floor(y0! * ratio));
        const bottom = Math.min(a.h, Math.ceil(y1! * ratio));
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const i = (y * a.w + x) * 4;
            if (
              a.d[i] !== b.d[i] ||
              a.d[i + 1] !== b.d[i + 1] ||
              a.d[i + 2] !== b.d[i + 2] ||
              a.d[i + 3] !== b.d[i + 3]
            ) {
              changed += 1;
            }
          }
        }
        return changed;
      });
    },
    [before.png, after.png, before.width, at] as [
      string,
      string,
      number,
      number[][],
    ],
  )) as number[] | null;
  assertTrue(
    counts !== null,
    "the two pages to draw the yard into pictures of the same size, so a " +
      "region of the stage is the same pixels in both",
  );
  return counts!;
}
