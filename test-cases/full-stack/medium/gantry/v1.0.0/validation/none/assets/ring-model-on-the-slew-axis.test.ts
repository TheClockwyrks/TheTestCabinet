// assets/ring-model-on-the-slew-axis — the ring is drawn on the slew axis, and
// between its own two flanges.
//
// specs/assets.md § The models says where the model goes: "The game draws each
// model wherever its subject is: the ring centered on the slew axis between its
// flanges …". specs/structure.md fixes both terms. The ring "is placed by its
// base corner, a lattice node `(x, y, z)`, and occupies eight nodes: the bottom
// flange, the four nodes … and the top flange, the same four nodes at
// `y + LATTICE_PITCH`", and "the slew axis is the vertical line through the
// flange square's center, `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)`".
// So the model belongs in the column of yard over the flange square, between
// `y` and `y + LATTICE_PITCH`, and nowhere else.
//
// WHERE THE RING IS DRAWN IS READ BY SERVING A DIFFERENT MODEL UNDER ITS FILE,
// not by placing the ring and looking at what changed. Placing one costs
// `RING_COST`, and specs/structure.md keeps "the current cost and the budget …
// always on screen in the editor", so the act of placing it legitimately redraws
// part of the stage that has nothing to do with where the ring is. Two pages of
// the same build, posed identically, served the same in every respect but the
// bytes under `assets/models/ring.glb`, differ in exactly the pixels the ring
// model draws — and this point asks where those pixels are.
//
// THE TOLERANCE IS A BOX, AND THESE ARE ITS SIDES. specs/assets.md sizes the ring
// "about `2.5 x 2 x 2.5` units" and adds that the part figures "are the intent,
// not a tolerance", so the column is allowed to be wider than the intent: it
// reaches `1.75` from the axis, where a ring of the stated size reaches `1.25`,
// and a third of a unit past each flange, where a ring of the stated height
// reaches neither. What that leaves no room for is a ring hung off the axis or
// standing above or below its flanges, which is what the sentence is about.
//
// THE WORLD IS THE RING ALONE: no members, no loads, no obstacles, no tape, so
// nothing else in the yard can account for a difference outside the column.

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertTrue, fail } from "../assert";
import { LATTICE_PITCH, STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** The subject's model, and the model served in its place. */
const SUBJECT = "ring";
const STAND_IN = "hook";

const SITE = 0;

/** The ring's base corner: off the ground, so specs/structure.md accepts it. */
const CORNER = { x: 0, y: 2, z: 0 };

/** The slew axis, and the two flange levels (specs/structure.md). */
const AXIS = {
  x: CORNER.x + LATTICE_PITCH / 2,
  z: CORNER.z + LATTICE_PITCH / 2,
};
const BOTTOM_FLANGE = CORNER.y;
const TOP_FLANGE = CORNER.y + LATTICE_PITCH;

/** How far from the slew axis, and past each flange, the ring may reach. */
const RADIUS = 1.75;
const OVERHANG = 0.35;

/** Slack around the projected column before the stage must be untouched. */
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

it("draws the ring inside the column over the flange square, between the flanges", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  await poseRing(served);
  const column = await columnRegion(served);
  const bands = surrounding(column);
  const before = {
    inside: await shot(served, column),
    outside: await Promise.all(bands.map((band) => shot(served, band.rect))),
  };
  await served.capture(
    "ring",
    "The ring on the slew axis, between its flanges",
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
  await poseRing(substituted);

  const spilled: string[] = [];
  for (const [index, band] of bands.entries()) {
    const again = await shot(substituted, band.rect);
    if (!before.outside[index]!.equals(again)) spilled.push(band.where);
  }
  if (spilled.length > 0) {
    fail(
      `the ring drawn inside ${RADIUS} units of the slew axis at ` +
        `(${AXIS.x}, ${AXIS.z}) and between the ${BOTTOM_FLANGE} and ` +
        `${TOP_FLANGE} flange levels, so serving other bytes under ` +
        `assets/models/${SUBJECT}.glb changes nothing outside that column ` +
        "(specs/assets.md, specs/structure.md)",
      `the stage changed ${spilled.join(", ")} as well, so the ring's model is ` +
        "drawn off the slew axis or past a flange",
    );
  }

  const insideAgain = await shot(substituted, column);
  assertTrue(
    !before.inside.equals(insideAgain),
    "the ring to be drawn inside the column over its flange square at all, so " +
      "that the untouched stage around it is a reading of where the ring is " +
      `rather than of a build drawing no ring (specs/assets.md)`,
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

/** The isolated world this point is about: the slew ring and nothing else. */
async function poseRing(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  await h.advance(1);
  const { structure } = await h.snapshot();
  if (structure.ring === null) {
    fail(
      `the slew ring at (${CORNER.x}, ${CORNER.y}, ${CORNER.z}) to stand on an ` +
        "empty site, which specs/structure.md refuses nothing about",
      "the structure carries no ring",
    );
  }
}

/** Where the build says the column over the flange square is drawn. */
async function columnRegion(h: Harness): Promise<Rect> {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const x of [AXIS.x - RADIUS, AXIS.x + RADIUS]) {
    for (const y of [BOTTOM_FLANGE - OVERHANG, TOP_FLANGE + OVERHANG]) {
      for (const z of [AXIS.z - RADIUS, AXIS.z + RADIUS]) {
        const on = await h.project(x, y, z);
        assertTrue(
          on.visible,
          `the corner (${x}, ${y}, ${z}) of the ring's column to be drawn on ` +
            "the stage at the start camera pose, so this point has a picture " +
            "to read (specs/instrumentation.md)",
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

/** The four bands of stage outside that column, with a margin. */
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
