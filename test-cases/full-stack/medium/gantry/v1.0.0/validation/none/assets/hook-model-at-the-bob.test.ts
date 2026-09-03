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

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertTrue, fail } from "../assert";
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
    const before = {
      inside: await shot(served, region),
      outside: await Promise.all(bands.map((band) => shot(served, band.rect))),
    };

    const spilled: string[] = [];
    for (const [index, band] of bands.entries()) {
      const again = await shot(substituted, band.rect);
      if (!before.outside[index]!.equals(again)) spilled.push(band.where);
    }
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

    const insideAgain = await shot(substituted, region);
    assertTrue(
      !before.inside.equals(insideAgain),
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

/** Where the build itself says a box around `at` is drawn, in logical units. */
async function boxRegion(h: Harness, at: Vec3): Promise<Rect> {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [-HALF, HALF]) {
    for (const dy of [-HALF, HALF]) {
      for (const dz of [-HALF, HALF]) {
        const on = await h.project(at.x + dx, at.y + dy, at.z + dz);
        assertTrue(
          on.visible,
          `the corner (${(at.x + dx).toFixed(2)}, ${(at.y + dy).toFixed(2)}, ` +
            `${(at.z + dz).toFixed(2)}) of the block's box to be drawn on the ` +
            "stage at the start camera pose, so this point has a picture to " +
            "read (specs/instrumentation.md)",
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

/** A logical rectangle of one page's composited frame, as PNG bytes. */
async function shot(h: Harness, rect: Rect): Promise<Buffer> {
  const fit = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as Rect | null;
  assertTrue(fit !== null, "a <canvas> on the page for the build to draw in");
  const sx = fit!.width / STAGE_W;
  const sy = fit!.height / STAGE_H;
  return h.page.screenshot({
    clip: {
      x: fit!.x + rect.x * sx,
      y: fit!.y + rect.y * sy,
      width: Math.max(1, rect.width * sx),
      height: Math.max(1, rect.height * sy),
    },
  });
}
