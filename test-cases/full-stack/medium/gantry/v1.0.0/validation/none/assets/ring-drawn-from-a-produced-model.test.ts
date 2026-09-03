// assets/ring-drawn-from-a-produced-model — the slew ring on screen is the
// committed `ring` model, decoded and drawn.
//
// specs/assets.md opens with the whole of the requirement: the build "produces
// every model and sound the game uses with them, commits the produced files, and
// wires them in", each committed as `assets/models/<model>.glb` "under the model
// name the table below gives it", and "the name a file carries is what says which
// subject or which cue it is". The table's first row is `ring`, "the slew ring: a
// squat bearing drum between its flanges". § What is drawn in code draws the line
// from the other side: the yard, the aids, the members, the cable, the pads and
// every readout are the build's own geometry, and the eight models are not.
//
// SO THE READING IS THE FILE'S CONTENTS. A ring drawn from the committed file and
// a ring drawn as geometry the build wrote look alike on a served site; what tells
// them apart is serving the site with DIFFERENT BYTES under that file. Two pages
// load the same `dist/`, posed identically: one with everything served, one where
// every response carrying the bytes of `assets/models/ring.glb` is answered with
// the bytes of another of the build's own committed models instead. A ring drawn
// from the produced file is then drawn as that other model, and the stage where
// the ring stands changes; a ring drawn in code does not move a pixel.
//
// SUBSTITUTED RATHER THAN WITHHELD. Withholding the file would be the sharper
// probe and is not a fair one: a build is free to await its whole produced asset
// set before it stands the game up, so a missing model can legitimately leave no
// game at all, and every point would then fail on a build that had done exactly
// what specs/assets.md asked. The substitute is one of the build's OWN committed
// models, so it decodes through the same loader and the game comes up normally.
//
// THE FILE IS MATCHED BY ITS BYTES, NEVER BY ITS URL. What a bundler names the
// copy it emits into `dist/` is the build's business — specs/assets.md asks only
// that each asset be referenced page-relative through the bundler — so each
// served response is compared against the bytes of the committed file rather than
// against any path.
//
// WHY THE BANDS. Two fresh pages of one build draw the same frame, so the stage
// outside the ring's own extent has to come back byte-identical between them.
// That is what makes the difference inside that extent a reading of the ring
// rather than of two pages that happened to differ.
//
// THE WORLD IS THE RING ALONE. specs/structure.md refuses a ring only for a second
// ring, the envelope, a base corner on the ground, the arm-to-tower rule and the
// budget, so a ring stands with nothing else built — which is the world this point
// wants: no members, no loads, no obstacles, no tape.

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertGreaterThan, assertTrue, fail } from "../assert";
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

/**
 * The slew axis: "the vertical line through the flange square's center",
 * `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)` (specs/structure.md).
 */
const AXIS = {
  x: CORNER.x + LATTICE_PITCH / 2,
  z: CORNER.z + LATTICE_PITCH / 2,
};

/**
 * The world box the ring's drawing is held inside, centered on the slew axis.
 *
 * specs/assets.md sizes the ring "about `2.5 x 2 x 2.5` units" and says of the
 * part figures that they "are the intent, not a tolerance", so the box is half
 * again as wide as that intent and reaches a unit past each flange — room for any
 * ring a build sculpts to it, and for the smaller stand-in drawn in its place.
 */
const HALF = 2;
const Y_LOW = CORNER.y - 1;
const Y_HIGH = CORNER.y + LATTICE_PITCH + 1;

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

it("draws the ring from the committed ring model", async () => {
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
  const region = await ringRegion(served);
  const bands = surrounding(region);
  const before = {
    inside: await shot(served, region),
    outside: await Promise.all(bands.map((band) => shot(served, band.rect))),
  };
  await served.capture("ring", "The ring drawn from its produced model");

  // The same build, served again with the ring's model replaced by another of
  // its own.
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
  await poseRing(substituted);

  assertGreaterThan(
    replaced,
    0,
    "the responses the served site answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a site that never serves that file draws no ring " +
      "from it",
  );

  const spilled: string[] = [];
  for (const [index, band] of bands.entries()) {
    const again = await shot(substituted, band.rect);
    if (!before.outside[index]!.equals(again)) spilled.push(band.where);
  }
  if (spilled.length > 0) {
    fail(
      "the stage outside the ring's own extent to be drawn the same whichever " +
        "model the site serves under the ring's file, so that what changes " +
        "inside that extent is the ring (specs/assets.md)",
      `it differs ${spilled.join(", ")}, so this build draws a different yard ` +
        "rather than simply a different ring",
    );
  }

  const insideAgain = await shot(substituted, region);
  assertTrue(
    !before.inside.equals(insideAgain),
    "the ring on the stage to change when the site serves other bytes under " +
      `assets/models/${SUBJECT}.glb, since the ring on screen is that ` +
      "produced model decoded and drawn rather than geometry the build draws " +
      "in code (specs/assets.md)",
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
  if ((await h.snapshot()).structure.ring === null) {
    fail(
      `the slew ring at (${CORNER.x}, ${CORNER.y}, ${CORNER.z}) to stand on an ` +
        "empty site, which specs/structure.md refuses nothing about",
      "the structure carries no ring",
    );
  }
}

/** Where the build itself says the ring's box is drawn, in logical units. */
async function ringRegion(h: Harness): Promise<Rect> {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const x of [AXIS.x - HALF, AXIS.x + HALF]) {
    for (const y of [Y_LOW, Y_HIGH]) {
      for (const z of [AXIS.z - HALF, AXIS.z + HALF]) {
        const at = await h.project(x, y, z);
        assertTrue(
          at.visible,
          `the corner (${x}, ${y}, ${z}) of the ring's box to be drawn on the ` +
            "stage at the start camera pose, so this point has a picture to " +
            "read (specs/instrumentation.md)",
        );
        left = Math.min(left, at.x);
        right = Math.max(right, at.x);
        top = Math.min(top, at.y);
        bottom = Math.max(bottom, at.y);
      }
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The four bands of stage outside the ring's extent, with a margin. */
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
