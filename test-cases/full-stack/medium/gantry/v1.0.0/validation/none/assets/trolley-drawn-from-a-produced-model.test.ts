// assets/trolley-drawn-from-a-produced-model — the carriage on the rail is the
// committed `trolley` model, decoded and drawn.
//
// specs/assets.md § The models: "trolley | the carriage on the rail", one of the
// eight models the build "produces … commits … and wires in", each committed as
// `assets/models/<model>.glb` under the name that table gives it. § What is drawn
// in code puts the members, the cable and the aids on the other side of the line:
// the rail the trolley runs on is the build's own geometry, the carriage on it is
// not.
//
// THE READING IS THE FILE'S CONTENTS. Two pages load the same `dist/`, posed
// identically, one of them served with every response carrying the bytes of
// `assets/models/trolley.glb` answered with the bytes of another of the build's
// own committed models. A trolley drawn from the produced file is then drawn as
// that other model and the stage where the carriage stands changes; a trolley
// drawn in code does not move a pixel.
//
// SUBSTITUTED RATHER THAN WITHHELD, and matched by BYTES rather than by URL, for
// the reasons `ring-drawn-from-a-produced-model` sets out: a build may
// legitimately await its whole produced asset set before it stands the game up,
// so withholding a model can fairly leave no game at all; and what a bundler
// names the copy it emits into `dist/` is the build's own business.
//
// THE TROLLEY IS REACHED THROUGH A RUN. specs/structure.md: "The trolley is the
// carriage the hoist cable hangs from. It exists whenever the structure has rail
// members", and its position is "its distance along the track from that origin".
// The minimal crane's single rail runs from `(0, 4, 0)` to `(4, 4, 0)` with the
// near end as the track origin, so a trolley posed at `2` stands at `(2, 4, 0)` —
// away from the origin, so a build that drew its carriage at the track's start
// instead would draw nothing in the extent this point reads.
//
// THE WORLD IS THE CRANE ALONE: no loads and no obstacles, and the tape is one
// grip move, the only axis whose motion "applies no force to anything", so the
// run stays running and nothing in the yard moves between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import { GRIP_MAX_RATE, STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** The subject's model, and the model served in its place. */
const SUBJECT = "trolley";
const STAND_IN = "hook";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Where along the minimal crane's track the carriage is posed, and where that is. */
const TROLLEY_AT = 2;
const CARRIAGE = { x: 2, y: 4, z: 0 };

/**
 * The world box the carriage's drawing is held inside.
 *
 * specs/assets.md sizes the trolley "about `1.5 x 1 x 1.5` units" and says of the
 * part figures that they "are the intent, not a tolerance", so the box reaches
 * two units each way — room for any carriage a build sculpts to that intent, and
 * for the stand-in drawn in its place.
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

it("draws the trolley from the committed trolley model", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  await poseCarriage(served);
  const region = await boxRegion(served, CARRIAGE);
  const bands = surrounding(region);
  const before = await frame(served);
  await served.capture("trolley", "The trolley drawn from its produced model");

  let replaced = 0;
  context = served.page.context();
  await context.route("**/*", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.length === subject.length && body.equals(subject)) {
      replaced += 1;
      await route.fulfill({ response, body: standIn });
      return;
    }
    // Answered from the fetched response itself, rather than by handing the
    // same bytes back: the bundle and the music bed would otherwise cross the
    // protocol a second time.
    await route.fulfill({ response });
  });
  substituted = await createHarness();
  await poseCarriage(substituted);

  assertGreaterThan(
    replaced,
    0,
    "the responses the served site answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a site that never serves that file draws no " +
      "trolley from it",
  );

  const after = await frame(substituted);

  const spilled: string[] = [];
  for (const band of bands) {
    if (!alike(before, after, band.rect)) spilled.push(band.where);
  }
  if (spilled.length > 0) {
    fail(
      "the stage outside the carriage's own extent to be drawn the same " +
        "whichever model the site serves under the trolley's file, so that " +
        "what changes inside that extent is the trolley (specs/assets.md)",
      `it differs ${spilled.join(", ")}, so this build draws a different yard ` +
        "rather than simply a different carriage",
    );
  }

  assertTrue(
    !alike(before, after, region),
    "the carriage on the stage to change when the site serves other bytes " +
      `under assets/models/${SUBJECT}.glb, since the trolley on screen is ` +
      "that produced model decoded and drawn rather than geometry the build " +
      "draws in code (specs/assets.md)",
  );
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

/** The isolated world this point is about: one crane, running, one carriage. */
async function poseCarriage(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.advance(1);
  const { run } = await h.snapshot();
  if (Math.abs(run.axes.trolley.value - TROLLEY_AT) > 1e-6) {
    fail(
      `the trolley axis to stand at ${TROLLEY_AT} along the track after it is ` +
        "posed there, which specs/instrumentation.md's `setAxis` establishes",
      `it reads ${run.axes.trolley.value}`,
    );
  }
}

/** Where the build itself says a box around `at` is drawn, in logical units. */
async function boxRegion(
  h: Harness,
  at: { x: number; y: number; z: number },
): Promise<Rect> {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [-HALF, HALF]) {
    for (const dy of [-HALF, HALF]) {
      for (const dz of [-HALF, HALF]) {
        const point = { x: at.x + dx, y: at.y + dy, z: at.z + dz };
        const on = await h.project(point.x, point.y, point.z);
        assertTrue(
          on.visible,
          `the corner (${point.x}, ${point.y}, ${point.z}) of the carriage's ` +
            "box to be drawn on the stage at the start camera pose, so this " +
            "point has a picture to read (specs/instrumentation.md)",
        );
        left = Math.min(left, on.x);
        right = Math.max(right, on.x);
        top = Math.min(top, on.y);
        bottom = Math.max(bottom, on.y);
      }
    }
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

/**
 * One page's whole composited frame, decoded, with the map from stage units.
 *
 * ONE COMPOSITE PER PAGE, READ MANY WAYS. A clipped capture costs a fresh
 * composite for every rectangle, and the pixels a clip returns are the pixels
 * this frame already holds — so the extent and the bands are read out of one
 * capture instead of one apiece. The build fits the stage into its own canvas,
 * so a logical rectangle is mapped through the canvas the page reports rather
 * than through any fit assumed here.
 */
interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Image pixels per logical stage unit, and where the stage's origin lands. */
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

async function frame(h: Harness): Promise<Frame> {
  const fit = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as Rect | null;
  assertTrue(fit !== null, "a <canvas> on the page for the build to draw in");
  const view = h.page.viewportSize();
  assertTrue(view !== null, "a sized viewport on the page the build draws in");
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await h.paintFrame();
  const png = await h.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  const dx = image.width / view!.width;
  const dy = image.height / view!.height;
  return {
    width: image.width,
    height: image.height,
    data,
    sx: (fit!.width / STAGE_W) * dx,
    sy: (fit!.height / STAGE_H) * dy,
    ox: fit!.x * dx,
    oy: fit!.y * dy,
  };
}

/** Whether two frames are drawn identically over a logical rectangle. */
function alike(a: Frame, b: Frame, rect: Rect): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const x0 = Math.max(0, Math.round(a.ox + rect.x * a.sx));
  const y0 = Math.max(0, Math.round(a.oy + rect.y * a.sy));
  const x1 = Math.min(a.width, Math.round(a.ox + (rect.x + rect.width) * a.sx));
  const y1 = Math.min(
    a.height,
    Math.round(a.oy + (rect.y + rect.height) * a.sy),
  );
  for (let y = y0; y < y1; y += 1) {
    let i = (y * a.width + x0) * 4;
    for (let x = x0; x < x1; x += 1, i += 4) {
      if (
        a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2] ||
        a.data[i + 3] !== b.data[i + 3]
      ) {
        return false;
      }
    }
  }
  return true;
}
