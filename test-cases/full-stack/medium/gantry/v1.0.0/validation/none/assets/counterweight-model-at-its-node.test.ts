// assets/counterweight-model-at-its-node — a counterweight is drawn at each node
// that carries one, and nowhere else.
//
// specs/assets.md § The models says where each produced model is drawn: "The game
// draws each model wherever its subject is: … a counterweight at each carrying
// node …". specs/structure.md says what a carrying node is — a counterweight is
// "placed on any node the structure uses, a node a member ends at or a flange node
// of the ring" — and that "a node carries at most one counterweight". So a
// structure carrying two of them owes a block at both nodes, and none anywhere
// else in the yard.
//
// TWO NODES RATHER THAN ONE, because one cannot tell a build that draws a block
// at each carrying node from one that draws a single block at some fixed place.
// The two struts stand eight units apart, which is four lattice pitches: far
// enough that the two blocks' extents are separate stretches of stage with yard
// between them, and that stretch is read too.
//
// WHERE THE BLOCKS ARE IS READ BY SERVING A DIFFERENT MODEL UNDER THE
// COUNTERWEIGHT'S FILE, not by adding the counterweights and looking at what
// changed. Placing one costs `COUNTERWEIGHT_COST`, and specs/structure.md keeps
// "the current cost and the budget … always on screen in the editor", so the act
// of placing a block legitimately redraws part of the stage that has nothing to
// do with where blocks are drawn. Two pages of the same build, posed identically,
// served the same in every respect but the bytes under
// `assets/models/counterweight.glb`, differ in exactly the pixels the
// counterweight model draws — which is the reading this point wants.
//
// THE WORLD IS TWO STRUTS AND TWO BLOCKS: no ring, no rail, no loads, no
// obstacles, no tape, so nothing else in the yard can account for a difference.

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertTrue, fail } from "../assert";
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
const SUBJECT = "counterweight";
const STAND_IN = "hook";

const SITE = 0;

/** The two struts, and the two nodes their upper ends carry a block on. */
const STRUTS: readonly { foot: Vec3; node: Vec3 }[] = [
  { foot: { x: 0, y: 0, z: 0 }, node: { x: 0, y: 2, z: 0 } },
  { foot: { x: 8, y: 0, z: 0 }, node: { x: 8, y: 2, z: 0 } },
];

/**
 * How far around a node its block's drawing is held.
 *
 * specs/assets.md sizes the counterweight "about `1.5 x 1.5 x 1.5` units" and
 * says of the part figures that they "are the intent, not a tolerance", so the
 * box reaches two units each way — room for any block a build sculpts to that
 * intent, and for the stand-in drawn in its place.
 */
const HALF = 2;

/** Slack around a projected box before the stage must be untouched. */
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

it("draws a counterweight at each of the two carrying nodes", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  await poseBlocks(served);
  const nodes = await Promise.all(
    STRUTS.map((strut) => boxRegion(served, strut.node)),
  );
  const bands = elsewhere(nodes);
  const before = {
    nodes: await Promise.all(nodes.map((rect) => shot(served, rect))),
    elsewhere: await Promise.all(bands.map((band) => shot(served, band.rect))),
  };
  await served.capture(
    "counterweights",
    "A counterweight at each of the two carrying nodes",
  );

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
  await poseBlocks(substituted);

  const bare: string[] = [];
  for (const [index, rect] of nodes.entries()) {
    const again = await shot(substituted, rect);
    if (before.nodes[index]!.equals(again)) {
      const node = STRUTS[index]!.node;
      bare.push(`(${node.x}, ${node.y}, ${node.z})`);
    }
  }
  if (bare.length > 0) {
    fail(
      "a counterweight drawn at each node carrying one, so serving other " +
        `bytes under assets/models/${SUBJECT}.glb changes the stage at both ` +
        "of them (specs/assets.md)",
      `nothing there changed at ${bare.join(" or ")}`,
    );
  }

  const stray: string[] = [];
  for (const [index, band] of bands.entries()) {
    const again = await shot(substituted, band.rect);
    if (!before.elsewhere[index]!.equals(again)) stray.push(band.where);
  }
  if (stray.length > 0) {
    fail(
      "the counterweight model drawn at the carrying nodes and nowhere else, " +
        "so the rest of the stage is the same whichever model the site serves " +
        `under assets/models/${SUBJECT}.glb (specs/assets.md)`,
      `it changed ${stray.join(", ")} as well`,
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

/** The isolated world this point is about: two struts, a block on each. */
async function poseBlocks(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  for (const { foot, node } of STRUTS) {
    await h.debug.addMember(
      foot.x,
      foot.y,
      foot.z,
      node.x,
      node.y,
      node.z,
      "strut",
    );
    await h.debug.addCounterweight(node.x, node.y, node.z);
  }
  await h.advance(1);
  const { structure } = await h.snapshot();
  if (structure.counterweights.length !== STRUTS.length) {
    fail(
      `${STRUTS.length} counterweights standing, one on each node a strut ` +
        "ends at, which specs/structure.md accepts",
      `${structure.counterweights.length} stand`,
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
    for (const dy of [-HALF, HALF]) {
      for (const dz of [-HALF, HALF]) {
        const on = await h.project(at.x + dx, at.y + dy, at.z + dz);
        assertTrue(
          on.visible,
          `the corner (${at.x + dx}, ${at.y + dy}, ${at.z + dz}) of a block's ` +
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

/** Every stretch of stage outside the nodes' own extents, with a margin. */
function elsewhere(nodes: readonly Rect[]): { where: string; rect: Rect }[] {
  const grown = nodes.map((rect) => ({
    left: rect.x - BAND_MARGIN,
    right: rect.x + rect.width + BAND_MARGIN,
    top: rect.y - BAND_MARGIN,
    bottom: rect.y + rect.height + BAND_MARGIN,
  }));
  const hull = {
    left: Math.min(...grown.map((one) => one.left)),
    right: Math.max(...grown.map((one) => one.right)),
    top: Math.min(...grown.map((one) => one.top)),
    bottom: Math.max(...grown.map((one) => one.bottom)),
  };
  const bands: { where: string; rect: Rect }[] = [
    {
      where: "left of both nodes",
      rect: { x: 0, y: 0, width: hull.left, height: STAGE_H },
    },
    {
      where: "right of both nodes",
      rect: {
        x: hull.right,
        y: 0,
        width: STAGE_W - hull.right,
        height: STAGE_H,
      },
    },
    {
      where: "above them",
      rect: {
        x: hull.left,
        y: 0,
        width: hull.right - hull.left,
        height: hull.top,
      },
    },
    {
      where: "below them",
      rect: {
        x: hull.left,
        y: hull.bottom,
        width: hull.right - hull.left,
        height: STAGE_H - hull.bottom,
      },
    },
  ];
  // And the yard between the two nodes, which is inside the hull and is where a
  // block drawn at neither node would most easily hide.
  const ordered = [...grown].sort((a, b) => a.right - b.right);
  const gap = {
    x: ordered[0]!.right,
    y: hull.top,
    width: ordered[1]!.left - ordered[0]!.right,
    height: hull.bottom - hull.top,
  };
  bands.push({ where: "in the yard between them", rect: gap });
  return bands.filter(({ rect }) => rect.width >= 1 && rect.height >= 1);
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
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await h.paintFrame();
  return h.page.screenshot({
    clip: {
      x: fit!.x + rect.x * sx,
      y: fit!.y + rect.y * sy,
      width: Math.max(1, rect.width * sx),
      height: Math.max(1, rect.height * sy),
    },
  });
}
