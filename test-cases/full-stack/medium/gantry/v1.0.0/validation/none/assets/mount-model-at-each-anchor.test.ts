// assets/mount-model-at-each-anchor — a mount stands at every anchor the site
// fixes, and at no other lattice node.
//
// specs/assets.md § The models says where each produced model is drawn: "The game
// draws each model wherever its subject is: … a mount at each anchor …", the
// mount being "an anchor's ground fixture". specs/world.md fixes what an anchor
// is — "each site fixes its anchor nodes: lattice nodes on the ground where the
// structure is fixed to the earth" — so the fixtures stand at those nodes and at
// no other point of the ground lattice.
//
// HEAVY HAUL IS THE SITE FOR IT. specs/sites.md § Site 6 gives it nine anchors,
// `(0,0,0)` through `(4,0,4)` on the two-unit pitch, where every other site has
// four; a build that drew a fixture at some fixed four, or at one, or at every
// ground node, is told apart by nine and by the ground around them. The site is
// opened directly through `openSite`, "locked or not"
// (specs/instrumentation.md), so this point plays no site to reach it.
//
// WHERE THE FIXTURES ARE IS READ BY SERVING A DIFFERENT MODEL UNDER THE MOUNT'S
// FILE. The mounts are the site's own and cannot be posed away, so the reading
// is two pages of the same build, posed identically, served the same in every
// respect but the bytes under `assets/models/mount.glb`. They differ in exactly
// the pixels the mount model draws: at each of the nine anchors it must, and at
// a lattice node that is not an anchor it must not.
//
// THE NON-ANCHOR NODES ARE SIX UNITS OUT, three lattice pitches clear of the
// nearest anchor and inside Heavy Haul's envelope (`x -10..18`, `z -8..8`), so
// the stage each of them occupies is its own and cannot catch the edge of a
// neighboring anchor's fixture.
//
// THE WORLD IS THE SITE'S ANCHORS ALONE: no structure, no loads, no obstacles.
//
// ONE PICTURE PER PAGE, AND ONE CROSSING FOR THE THIRTEEN BOXES. Both readings
// this point takes are of the same still frame, so each page is photographed once
// and the thirteen boxes are counted over those two frames inside the page —
// rather than thirteen clipped screenshots per page, each of which costs a whole
// composited frame off a software renderer. The `project` calls that place the
// boxes go the same way: `project` is a reading and thirteen boxes need a hundred
// and four of them, so they are asked for together through the build's own
// `window.__gantry` handle, which is the surface `specs/instrumentation.md`
// exposes and the surface `Harness.project` itself calls. What is read is
// identical either way; only the number of crossings is not.

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertEqual, assertTrue, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  HANDLE,
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Projected,
  type Vec3,
} from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** The subject's model, and the model served in its place. */
const SUBJECT = "mount";
const STAND_IN = "hook";

/** Heavy Haul, `specs/sites.md`'s sixth site, counted from `0`. */
const SITE = 5;

/** The nine anchors specs/sites.md § Site 6 fixes. */
const ANCHORS: readonly Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 0, y: 0, z: 2 },
  { x: 2, y: 0, z: 2 },
  { x: 4, y: 0, z: 2 },
  { x: 0, y: 0, z: 4 },
  { x: 2, y: 0, z: 4 },
  { x: 4, y: 0, z: 4 },
];

/** Ground lattice nodes of the same site that are not anchors. */
const BARE: readonly Vec3[] = [
  { x: 10, y: 0, z: 0 },
  { x: -6, y: 0, z: 0 },
  { x: 0, y: 0, z: -6 },
  { x: 10, y: 0, z: -6 },
];

/**
 * How far around a node its fixture's drawing is read.
 *
 * specs/assets.md sizes the mount "about `1.5 x 0.75 x 1.5` units", so a box
 * reaching `0.9` each way horizontally holds a fixture of that intent while
 * staying inside the two-unit pitch between one anchor and the next, and the
 * vertical span covers a fixture standing on the ground and the stand-in drawn in
 * its place.
 */
const HALF = 0.9;
const Y_LOW = -0.5;
const Y_HIGH = 1.5;

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

it("draws a mount at each of the site's nine anchors and at no other node", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  await bareSite(served);
  const nodes = [...ANCHORS, ...BARE];
  const boxes = await boxRegions(served, nodes);
  const before = await frameOf(served);
  await served.capture("anchors", "The nine anchors with their mounts");

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
  await bareSite(substituted);
  const after = await frameOf(substituted);

  // How many pixels each box changed when the bytes under the mount's file did.
  const changed = await countChanged(served, before, after, boxes);

  const missing = ANCHORS.filter((_, index) => changed[index] === 0).map(name);
  if (missing.length > 0) {
    fail(
      "a mount drawn at each of Heavy Haul's nine anchors, so serving other " +
        `bytes under assets/models/${SUBJECT}.glb changes the stage at every ` +
        "one of them (specs/assets.md, specs/sites.md)",
      `nothing there changed at ${missing.join(", ")}`,
    );
  }

  const spurious = BARE.filter(
    (_, index) => changed[ANCHORS.length + index]! > 0,
  ).map(name);
  if (spurious.length > 0) {
    fail(
      "the mount model drawn at the site's anchors and at no other lattice " +
        "node, so the ground away from them is the same whichever model the " +
        `site serves under assets/models/${SUBJECT}.glb (specs/assets.md)`,
      `it changed at ${spurious.join(", ")}, none of which Heavy Haul fixes ` +
        "as an anchor",
    );
  }
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

/** A node, written the way this point's failures name one. */
function name(node: Vec3): string {
  return `(${node.x}, ${node.y}, ${node.z})`;
}

/** The isolated world this point is about: Heavy Haul's anchors, nothing else. */
async function bareSite(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);
  const { site, structure } = await h.snapshot();
  assertEqual(
    site.anchors.length,
    ANCHORS.length,
    "the anchor nodes the open site reports, which specs/sites.md fixes at " +
      "nine for Heavy Haul",
  );
  if (structure.members.length !== 0 || structure.ring !== null) {
    fail(
      "an empty structure, so the only thing standing at an anchor is its " +
        "mount (specs/instrumentation.md's `clearStructure`)",
      `${structure.members.length} members and ` +
        `${structure.ring === null ? "no" : "a"} ring stand`,
    );
  }
}

/**
 * Where the build itself says a box around each node is drawn, in logical units.
 *
 * The eight corners of every node's box go in one crossing, through the same
 * `project` operation `Harness.project` calls: one reading per corner either way.
 */
async function boxRegions(h: Harness, nodes: readonly Vec3[]): Promise<Rect[]> {
  const corners: [number, number, number][] = [];
  for (const at of nodes) {
    for (const dx of [-HALF, HALF]) {
      for (const y of [Y_LOW, Y_HIGH]) {
        for (const dz of [-HALF, HALF]) {
          corners.push([at.x + dx, at.y + y, at.z + dz]);
        }
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

  const regions: Rect[] = [];
  for (const [index, at] of nodes.entries()) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < 8; i += 1) {
      const on = drawn[index * 8 + i]!;
      const [x, y, z] = corners[index * 8 + i]!;
      assertTrue(
        on.visible,
        `the corner (${x}, ${y}, ${z}) of the node ${name(at)}'s box to be ` +
          "drawn on the stage at the start camera pose, so this point has a " +
          "picture to read (specs/instrumentation.md)",
      );
      left = Math.min(left, on.x);
      right = Math.max(right, on.x);
      top = Math.min(top, on.y);
      bottom = Math.max(bottom, on.y);
    }
    regions.push({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }
  return regions;
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
 * thirteen counts come back out.
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
