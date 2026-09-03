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
// neighbouring anchor's fixture.
//
// THE WORLD IS THE SITE'S ANCHORS ALONE: no structure, no loads, no obstacles.

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertEqual, assertTrue, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
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
  const anchorRects = await Promise.all(
    ANCHORS.map((node) => boxRegion(served, node)),
  );
  const bareRects = await Promise.all(
    BARE.map((node) => boxRegion(served, node)),
  );
  const before = {
    anchors: await Promise.all(anchorRects.map((rect) => shot(served, rect))),
    bare: await Promise.all(bareRects.map((rect) => shot(served, rect))),
  };
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

  const missing: string[] = [];
  for (const [index, rect] of anchorRects.entries()) {
    const again = await shot(substituted, rect);
    if (before.anchors[index]!.equals(again))
      missing.push(name(ANCHORS[index]!));
  }
  if (missing.length > 0) {
    fail(
      "a mount drawn at each of Heavy Haul's nine anchors, so serving other " +
        `bytes under assets/models/${SUBJECT}.glb changes the stage at every ` +
        "one of them (specs/assets.md, specs/sites.md)",
      `nothing there changed at ${missing.join(", ")}`,
    );
  }

  const spurious: string[] = [];
  for (const [index, rect] of bareRects.entries()) {
    const again = await shot(substituted, rect);
    if (!before.bare[index]!.equals(again)) spurious.push(name(BARE[index]!));
  }
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

/** Where the build itself says a box around `at` is drawn, in logical units. */
async function boxRegion(h: Harness, at: Vec3): Promise<Rect> {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [-HALF, HALF]) {
    for (const y of [Y_LOW, Y_HIGH]) {
      for (const dz of [-HALF, HALF]) {
        const on = await h.project(at.x + dx, at.y + y, at.z + dz);
        assertTrue(
          on.visible,
          `the corner (${at.x + dx}, ${at.y + y}, ${at.z + dz}) of the node ` +
            `${name(at)}'s box to be drawn on the stage at the start camera ` +
            "pose, so this point has a picture to read " +
            "(specs/instrumentation.md)",
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
