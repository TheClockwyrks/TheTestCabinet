// assets/counterweight-drawn-from-a-produced-model — a ballast block on the
// structure is the committed `counterweight` model, decoded and drawn.
//
// specs/assets.md § The models: "counterweight | a dense ballast block", one of
// the eight models the build "produces … commits … and wires in", each committed
// as `assets/models/<model>.glb` under the name that table gives it. § What is
// drawn in code keeps the members on the build's own side of the line; the block
// hung on a node is not.
//
// THE READING IS THE FILE'S CONTENTS. Two pages load the same `dist/`, posed
// identically, one of them served with every response carrying the bytes of
// `assets/models/counterweight.glb` answered with the bytes of another of the
// build's own committed models. A counterweight drawn from the produced file is
// then drawn as that other model and the stage at its node changes; one drawn in
// code does not move a pixel.
//
// SUBSTITUTED RATHER THAN WITHHELD, and matched by BYTES rather than by URL, for
// the reasons `ring-drawn-from-a-produced-model` sets out.
//
// THE WORLD IS ONE MEMBER AND ONE BLOCK. specs/structure.md places a
// counterweight "on any node the structure uses, a node a member ends at or a
// flange node of the ring", so the smallest world this point can be read in is a
// single strut and a block on its upper end — no ring, no rail, no loads, no
// obstacles, no tape.

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertGreaterThan, assertTrue, fail } from "../assert";
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

/** The one member the structure is: an anchor leg, well inside the envelope. */
const FOOT: Vec3 = { x: 0, y: 0, z: 0 };
const NODE: Vec3 = { x: 0, y: 2, z: 0 };

/**
 * The world box the block's drawing is held inside.
 *
 * specs/assets.md sizes the counterweight "about `1.5 x 1.5 x 1.5` units" and
 * says of the part figures that they "are the intent, not a tolerance", so the
 * box reaches two units each way — room for any block a build sculpts to that
 * intent, and for the stand-in drawn in its place.
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

it("draws a counterweight from the committed counterweight model", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  await poseBlock(served);
  const region = await boxRegion(served, NODE);
  const bands = surrounding(region);
  const before = {
    inside: await shot(served, region),
    outside: await Promise.all(bands.map((band) => shot(served, band.rect))),
  };
  await served.capture(
    "counterweight",
    "The counterweight drawn from its produced model",
  );

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
    await route.fulfill({ response, body });
  });
  substituted = await createHarness();
  await poseBlock(substituted);

  assertGreaterThan(
    replaced,
    0,
    "the responses the served site answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a site that never serves that file draws no " +
      "counterweight from it",
  );

  const spilled: string[] = [];
  for (const [index, band] of bands.entries()) {
    const again = await shot(substituted, band.rect);
    if (!before.outside[index]!.equals(again)) spilled.push(band.where);
  }
  if (spilled.length > 0) {
    fail(
      "the stage outside the block's own extent to be drawn the same " +
        "whichever model the site serves under the counterweight's file, so " +
        "that what changes inside that extent is the counterweight " +
        "(specs/assets.md)",
      `it differs ${spilled.join(", ")}, so this build draws a different yard ` +
        "rather than simply a different block",
    );
  }

  const insideAgain = await shot(substituted, region);
  assertTrue(
    !before.inside.equals(insideAgain),
    "the ballast block on the stage to change when the site serves other " +
      `bytes under assets/models/${SUBJECT}.glb, since a counterweight on ` +
      "screen is that produced model decoded and drawn rather than geometry " +
      "the build draws in code (specs/assets.md)",
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

/** The isolated world this point is about: one strut, one block on its top. */
async function poseBlock(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addMember(
    FOOT.x,
    FOOT.y,
    FOOT.z,
    NODE.x,
    NODE.y,
    NODE.z,
    "strut",
  );
  await h.debug.addCounterweight(NODE.x, NODE.y, NODE.z);
  await h.advance(1);
  const { structure } = await h.snapshot();
  if (structure.counterweights.length !== 1) {
    fail(
      `one counterweight standing on (${NODE.x}, ${NODE.y}, ${NODE.z}), a ` +
        "node the structure uses, which specs/structure.md accepts",
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
          `the corner (${at.x + dx}, ${at.y + dy}, ${at.z + dz}) of the ` +
            "block's box to be drawn on the stage at the start camera pose, " +
            "so this point has a picture to read (specs/instrumentation.md)",
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
