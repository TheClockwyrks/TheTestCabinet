// assets/container-drawn-from-a-produced-model — the container on screen is a produced model file, decoded and
// drawn.
//
// specs/assets.md, "The models": the eight models are produced with `voxel` and
// committed as `assets/models/<model>.glb`, and the table's row for
// `container` is "the `container` load class". specs/assets.md, intro: "The name
// a file carries is what says which subject or which cue it is", and each model
// is committed "under the model name the table below gives it". So the file
// that draws a container is not something a validator has to guess: it is the
// one the specification named.
//
// HOW A DRAWING IS SHOWN TO COME FROM A FILE. The site is served twice, once as
// it stands and once with the request for the container's model answered with a
// DIFFERENT committed model's bytes. If the container on screen is that file
// decoded and drawn, the picture where the container stands changes; if it is
// geometry the build draws in code, the file's contents make no difference and
// the picture is the same either way.
//
// WHY THE BYTES ARE SUBSTITUTED RATHER THAN WITHHELD. A build is entitled to
// treat a produced file that will not load as a failure to start — the files are
// its own and it ships all of them — so withholding one grades error handling
// rather than where the drawing comes from. Answering with another produced
// model keeps every load succeeding, keeps the build booting, and still makes
// the file's contents decide what is drawn. The substitute is the smallest
// committed model, so what it draws cannot spill outside the box the container
// occupies.
//
// AND THE CHANGE HAS TO BE CONFINED. Every other subject in the yard is drawn
// from its own file, so a build that really is drawing this one from this file
// leaves the rest of the frame identical: what the two pages differ in is the
// container and nothing else. That is what tells a model swapped out from a
// build that simply failed to start.
//
// THE FILE IS MATCHED BY ITS BYTES, NEVER BY ITS URL. What a bundler names the
// copy it emits into `dist/` is the build's business — specs/assets.md asks only
// that each asset be referenced page-relative through the bundler, and an
// emitted name carries a content hash. So every served response is compared
// against the bytes of the committed `assets/models/container.glb`, and the one
// that carries them is the one answered differently.
//
// THE TWO PAGES ARE DRIVEN IDENTICALLY, through the surface alone, and the game
// is off its own clock on both, so the frames are two pictures of the same posed
// world.
//
// AND ONE COMPOSITE IS TAKEN OFF EACH PAGE, read once inside the box and once
// per band. A clipped capture costs a fresh composite per rectangle, and the
// pixels it returns are the pixels the whole frame already holds, so ten
// captures bought nothing two composites read five ways each do not.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertEqual, assertTrue, fail } from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
import { createHarness, type Harness, type LoadPose, paintPage } from "../harness";

/** The build workspace: this suite is staged at `<workspace>/validation/assets/`. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The subject, and the model `specs/assets.md` names for it. */
const CLASS = "container" as const;

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

it("draws the container from the bytes of its produced model file", async () => {
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

  const drawn = { served: await frame(h.page), swapped: await frame(swapped) };

  assertTrue(
    !alike(drawn.served, drawn.swapped, inside),
    `the picture inside the ${CLASS}'s projected box to change when the bytes ` +
      `served for its produced model are another model's, since the ${CLASS} ` +
      "is that committed file decoded and drawn rather than geometry drawn in " +
      "code (specs/assets.md)",
  );

  const spilled: string[] = [];
  for (const band of outside) {
    if (!alike(drawn.served, drawn.swapped, band.rect))
      spilled.push(band.where);
  }
  assertEqual(
    spilled.join(", "),
    "",
    `the stage more than ${margin.toFixed(1)} logical pixels outside the ` +
      `${CLASS}'s projected box, which answering the ${CLASS}'s model with ` +
      "another's may not change: every other subject is drawn from its own " +
      "produced file (specs/assets.md)",
  );

  await h.capture("container", "The container drawn from its produced model");
});

/**
 * One page's whole composited frame, decoded, with the map from stage units.
 *
 * The build fits the stage into its own canvas, so a logical rectangle is
 * mapped through the canvas the page reports rather than through any fit
 * assumed here.
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

async function frame(page: Page): Promise<Frame> {
  const fit = (await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as Rect | null;
  assertTrue(fit !== null, "a <canvas> on the page for the build to draw in");
  const view = page.viewportSize();
  assertTrue(view !== null, "a sized viewport on the page the build draws in");
  // One held frame first; see `paint-gate.js`.
  await paintPage(page);
  const png = await page.screenshot({ type: "png" });
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
