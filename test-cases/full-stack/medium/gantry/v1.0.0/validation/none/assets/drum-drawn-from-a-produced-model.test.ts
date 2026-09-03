// assets/drum-drawn-from-a-produced-model — the drum on screen is a produced model file, decoded and
// drawn.
//
// specs/assets.md, "The models": the eight models are produced with `voxel` and
// committed as `assets/models/<model>.glb`, and the table's row for
// `drum` is "the `drum` load class". specs/assets.md, intro: "The name
// a file carries is what says which subject or which cue it is", and each model
// is committed "under the model name the table below gives it". So the file
// that draws a drum is not something a validator has to guess: it is the
// one the specification named.
//
// HOW A DRAWING IS SHOWN TO COME FROM A FILE. The site is served twice, once as
// it stands and once with the request for the drum's model answered with a
// DIFFERENT committed model's bytes. If the drum on screen is that file
// decoded and drawn, the picture where the drum stands changes; if it is
// geometry the build draws in code, the file's contents make no difference and
// the picture is the same either way.
//
// WHY THE BYTES ARE SUBSTITUTED RATHER THAN WITHHELD. A build is entitled to
// treat a produced file that will not load as a failure to start — the files are
// its own and it ships all of them — so withholding one grades error handling
// rather than where the drawing comes from. Answering with another produced
// model keeps every load succeeding, keeps the build booting, and still makes
// the file's contents decide what is drawn. The substitute is the smallest
// committed model, so what it draws cannot spill outside the box the drum
// occupies.
//
// AND THE CHANGE HAS TO BE CONFINED. Every other subject in the yard is drawn
// from its own file, so a build that really is drawing this one from this file
// leaves the rest of the frame identical: what the two pages differ in is the
// drum and nothing else. That is what tells a model swapped out from a
// build that simply failed to start.
//
// THE FILE IS MATCHED BY ITS BYTES, NEVER BY ITS URL. What a bundler names the
// copy it emits into `dist/` is the build's business — specs/assets.md asks only
// that each asset be referenced page-relative through the bundler, and an
// emitted name carries a content hash. So every served response is compared
// against the bytes of the committed `assets/models/drum.glb`, and the one
// that carries them is the one answered differently.
//
// THE TWO PAGES ARE DRIVEN IDENTICALLY, through the surface alone, and the game
// is off its own clock on both, so the frames are two pictures of the same posed
// world.
//
// AND EACH PAGE IS PHOTOGRAPHED ONCE. A frame under software GL costs about a
// second and a half to photograph, so the five rectangles this point reads are
// cut out of ONE picture of each page rather than asked for one screenshot at a
// time: the two frames are handed back into the browser, decoded, and compared
// rectangle by rectangle there. The reading is the same reading — every device
// pixel of a rectangle against the same pixel of the other — and it is taken off
// the same two frames, so nothing about what this point decides turns on it.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, fail } from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
import { createHarness, type Harness, type LoadPose, paintPage } from "../harness";

/** The build workspace: this suite is staged at `<workspace>/validation/assets/`. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The subject, and the model `specs/assets.md` names for it. */
const CLASS = "drum" as const;

/**
 * The models this point will answer the subject's request with, smallest first.
 *
 * Whichever is committed: the substitute only has to be a different produced
 * model, and a smaller one cannot draw outside the subject's own box.
 */
const SUBSTITUTES = [
  "hook",
  "mount",
  "trolley",
  "counterweight",
  "ring",
].filter((name) => name !== CLASS);

const SITE = 0;
const MASS = 40;

/** Where the one load stands: clear of the site's anchors, well inside frame. */
const POSE: LoadPose = { x: 7, y: 0, z: -3, yaw: 0 };

/** Slack around the projected hull, as a share of the box's own drawn size. */
const MARGIN_SHARE = 0.25;

/** A rectangle of the stage, in logical units. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pose the world this point reads, through the surface, on a loaded page. */
async function poseWorld(page: Page, pose: LoadPose): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__gantry !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(
    async ([site, cls, mass, at]) => {
      const surface = (
        window as unknown as Record<
          string,
          Record<string, (...args: unknown[]) => Promise<void>>
        >
      ).__gantry!;
      await surface.setAutoStep!(false);
      await surface.reset!();
      await surface.openSite!(site);
      await surface.clearLoads!();
      await surface.clearObstacles!();
      await surface.clearStructure!();
      await surface.clearProgram!();
      const where = at as { x: number; y: number; z: number; yaw: number };
      await surface.addLoad!(cls, mass, where.x, where.y, where.z, where.yaw);
      await surface.advance!(1);
    },
    [SITE, CLASS, MASS, pose] as const,
  );
}

let h: Harness;
let swapped: Page | null = null;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  if (swapped !== null) await swapped.close().catch(() => undefined);
  swapped = null;
  await h.dispose();
});

it("draws the drum from the bytes of its produced model file", async () => {
  // The subject's own committed file, which is what a served response is
  // recognised by, and the substitute's, which is what it is answered with —
  // both off the one root every produced file is committed under
  // (specs/assets.md).
  const own = join(WORKSPACE, "assets", "models", `${CLASS}.glb`);
  if (!existsSync(own)) {
    fail(
      `the ${CLASS}'s produced model committed at ` +
        `\`assets/models/${CLASS}.glb\` (specs/assets.md)`,
      "nothing is committed there",
    );
  }
  const subject = readFileSync(own);

  const substitute = SUBSTITUTES.map((name) => ({
    name,
    path: join(WORKSPACE, "assets", "models", `${name}.glb`),
  })).find((one) => existsSync(one.path));
  if (substitute === undefined) {
    fail(
      "another of the eight produced models committed under " +
        "`assets/models/<model>.glb`, which this point answers the " +
        `${CLASS}'s own request with (specs/assets.md)`,
      `none of [${SUBSTITUTES.join(", ")}] is committed there`,
    );
  }
  const bytes = readFileSync(substitute.path);

  // The same world on both pages: one load, nothing else in the yard, no
  // structure. The load sits on the ground, so its lift point is at its class
  // height (specs/world.md).
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const pose: LoadPose = { ...POSE, y: POSE.y + size.y };
  await poseWorld(h.page, pose);

  // And the same world again, with the subject's model answered by another's.
  let answered = 0;
  swapped = await h.page.context().newPage();
  await swapped.route("**/*", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.length !== subject.length || !body.equals(subject)) {
      await route.fulfill({ response });
      return;
    }
    answered += 1;
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body: bytes,
    });
  });
  await swapped.goto(h.page.url(), { waitUntil: "load" });
  await poseWorld(swapped, pose);

  assertTrue(
    answered > 0,
    `the served site to fetch the bytes of the committed ` +
      `\`assets/models/${CLASS}.glb\`, since the ${CLASS} is that produced ` +
      "file decoded and drawn and the build bundles the committed files " +
      "(specs/assets.md) — no response the site asked for carried them",
  );

  // Where the build says the subject's box is drawn (specs/instrumentation.md).
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [-size.x / 2, size.x / 2]) {
    for (const dz of [-size.z / 2, size.z / 2]) {
      for (const dy of [-size.y, 0]) {
        const at = (await h.project(pose.x + dx, pose.y + dy, pose.z + dz)) as {
          x: number;
          y: number;
          visible: boolean;
        };
        assertTrue(
          at.visible,
          `every corner of the ${CLASS}'s class box to be drawn on the stage ` +
            "at the start camera pose, so this point has a picture to read " +
            "(specs/instrumentation.md)",
        );
        left = Math.min(left, at.x);
        right = Math.max(right, at.x);
        top = Math.min(top, at.y);
        bottom = Math.max(bottom, at.y);
      }
    }
  }

  const inside: Rect = {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: Math.min(STAGE_W, right) - Math.max(0, left),
    height: Math.min(STAGE_H, bottom) - Math.max(0, top),
  };
  const margin = MARGIN_SHARE * Math.max(right - left, bottom - top);
  const near = {
    left: left - margin,
    right: right + margin,
    top: top - margin,
    bottom: bottom + margin,
  };
  const outside: { where: string; rect: Rect }[] = [
    {
      where: `left of the ${CLASS}`,
      rect: { x: 0, y: 0, width: near.left, height: STAGE_H },
    },
    {
      where: `right of the ${CLASS}`,
      rect: {
        x: near.right,
        y: 0,
        width: STAGE_W - near.right,
        height: STAGE_H,
      },
    },
    {
      where: `above the ${CLASS}`,
      rect: {
        x: near.left,
        y: 0,
        width: near.right - near.left,
        height: near.top,
      },
    },
    {
      where: `below the ${CLASS}`,
      rect: {
        x: near.left,
        y: near.bottom,
        width: near.right - near.left,
        height: STAGE_H - near.bottom,
      },
    },
  ];
  assertEqual(
    outside.filter(({ rect }) => rect.width >= 1 && rect.height >= 1).length,
    4,
    `the four bands of stage outside the ${CLASS}'s projected box, which this ` +
      "point needs the box to stand clear of the stage's edges for",
  );

  const fitOf = async (page: Page): Promise<Rect> => {
    const fit = (await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (canvas === null) return null;
      const at = canvas.getBoundingClientRect();
      return { x: at.x, y: at.y, width: at.width, height: at.height };
    })) as Rect | null;
    assertTrue(fit !== null, "a <canvas> on the page for the build to draw in");
    return fit!;
  };
  const fits = { served: await fitOf(h.page), swapped: await fitOf(swapped) };
  const frameOf = async (page: Page, fit: Rect): Promise<string> => {
    // One held frame first; see `paint-gate.js`.
    await paintPage(page);
    return (
      await page.screenshot({
        clip: { x: fit.x, y: fit.y, width: fit.width, height: fit.height },
      })
    ).toString("base64");
  };
  const frames = {
    served: await frameOf(h.page, fits.served),
    swapped: await frameOf(swapped, fits.swapped),
  };

  /** A stage rectangle as a share of the stage, clamped to it. */
  const share = (rect: Rect): readonly [number, number, number, number] => {
    const x0 = Math.max(0, Math.min(STAGE_W, rect.x));
    const y0 = Math.max(0, Math.min(STAGE_H, rect.y));
    const x1 = Math.max(x0, Math.min(STAGE_W, rect.x + rect.width));
    const y1 = Math.max(y0, Math.min(STAGE_H, rect.y + rect.height));
    return [
      x0 / STAGE_W,
      y0 / STAGE_H,
      (x1 - x0) / STAGE_W,
      (y1 - y0) / STAGE_H,
    ];
  };
  const regions = [inside, ...outside.map((band) => band.rect)].map(share);

  // The comparison runs in the SWAPPED page, which nothing reads after this: the
  // page under test is left exactly as it was photographed, so the still this
  // point writes below is the frame it decided on.
  const differs = (await swapped.evaluate(
    async ([a, b, rects]) => {
      const decode = async (
        base64: string,
      ): Promise<OffscreenCanvasRenderingContext2D> => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1)
          bytes[i] = binary.charCodeAt(i);
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("no 2D context to decode a frame in");
        ctx.drawImage(bitmap, 0, 0);
        return ctx;
      };
      const one = await decode(a as string);
      const two = await decode(b as string);
      if (
        one.canvas.width !== two.canvas.width ||
        one.canvas.height !== two.canvas.height
      ) {
        throw new Error("the two pages drew at different sizes");
      }
      return (rects as readonly (readonly number[])[]).map((rect) => {
        const x = Math.round(rect[0]! * one.canvas.width);
        const y = Math.round(rect[1]! * one.canvas.height);
        const w = Math.max(
          1,
          Math.min(
            one.canvas.width - x,
            Math.round(rect[2]! * one.canvas.width),
          ),
        );
        const h = Math.max(
          1,
          Math.min(
            one.canvas.height - y,
            Math.round(rect[3]! * one.canvas.height),
          ),
        );
        const left = one.getImageData(x, y, w, h).data;
        const right = two.getImageData(x, y, w, h).data;
        for (let i = 0; i < left.length; i += 1) {
          if (left[i] !== right[i]) return true;
        }
        return false;
      });
    },
    [frames.served, frames.swapped, regions] as const,
  )) as boolean[];

  assertTrue(
    differs[0] === true,
    `the picture inside the ${CLASS}'s projected box to change when the bytes ` +
      `served for its produced model are another model's, since the ${CLASS} ` +
      "is that committed file decoded and drawn rather than geometry drawn in " +
      "code (specs/assets.md)",
  );

  const spilled = outside
    .filter((_, index) => differs[index + 1] === true)
    .map((band) => band.where);
  assertEqual(
    spilled.join(", "),
    "",
    `the stage more than ${margin.toFixed(1)} logical pixels outside the ` +
      `${CLASS}'s projected box, which answering the ${CLASS}'s model with ` +
      "another's may not change: every other subject is drawn from its own " +
      "produced file (specs/assets.md)",
  );

  await h.capture("drum", "The drum drawn from its produced model");
});
