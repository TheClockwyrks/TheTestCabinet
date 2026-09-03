// assets/mount-drawn-from-a-produced-model — the ground fixture at an anchor is
// the committed `mount` model, decoded and drawn.
//
// specs/assets.md § The models: "mount | an anchor's ground fixture", one of the
// eight models the build "produces … commits … and wires in", each committed as
// `assets/models/<model>.glb` under the name that table gives it, and the game
// draws "a mount at each anchor". § What is drawn in code keeps the yard's
// ground, the lattice and envelope aids on the build's own side of the line; the
// fixture standing at an anchor is not.
//
// THE READING IS THE FILE'S CONTENTS. Two pages load the same `dist/`, posed
// identically, one of them served with every response carrying the bytes of
// `assets/models/mount.glb` answered with the bytes of another of the build's own
// committed models. Mounts drawn from the produced file are then drawn as that
// other model and the stage over the anchors changes; fixtures drawn in code do
// not move a pixel.
//
// SUBSTITUTED RATHER THAN WITHHELD, and matched by BYTES rather than by URL, for
// the reasons `ring-drawn-from-a-produced-model` sets out.
//
// THE WORLD IS THE SITE'S ANCHORS AND NOTHING ELSE. specs/world.md makes the
// anchors the site's own — "each site fixes its anchor nodes" — so they stand
// with no structure, no loads and no obstacles, which is exactly the world this
// point wants. The extent read is the block of yard holding every anchor the open
// site carries, since a mount stands at each of them.

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
const SUBJECT = "mount";
const STAND_IN = "hook";

const SITE = 0;

/**
 * How far around the anchors the fixtures' drawing is held.
 *
 * specs/assets.md sizes the mount "about `1.5 x 0.75 x 1.5` units" and says of
 * the part figures that they "are the intent, not a tolerance", so the extent
 * reaches two units past the outermost anchor on each axis, and from a unit below
 * the ground to two above it — room for any fixture a build sculpts to that
 * intent, and for the stand-in drawn in its place.
 */
const PAD = 2;
const Y_LOW = -1;
const Y_HIGH = 2;

/** Slack around the projected extent before the stage must be untouched. */
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

it("draws the anchor mounts from the committed mount model", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  const anchors = await bareSite(served);
  const region = await anchorRegion(served, anchors);
  const bands = surrounding(region);
  const before = {
    inside: await shot(served, region),
    outside: await Promise.all(bands.map((band) => shot(served, band.rect))),
  };
  await served.capture("mount", "The mount drawn from its produced model");

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
  await bareSite(substituted);

  assertGreaterThan(
    replaced,
    0,
    "the responses the served site answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a site that never serves that file draws no mount " +
      "from it",
  );

  const spilled: string[] = [];
  for (const [index, band] of bands.entries()) {
    const again = await shot(substituted, band.rect);
    if (!before.outside[index]!.equals(again)) spilled.push(band.where);
  }
  if (spilled.length > 0) {
    fail(
      "the stage outside the anchors' own extent to be drawn the same " +
        "whichever model the site serves under the mount's file, so that what " +
        "changes inside that extent is the mounts (specs/assets.md)",
      `it differs ${spilled.join(", ")}, so this build draws a different yard ` +
        "rather than simply different fixtures",
    );
  }

  const insideAgain = await shot(substituted, region);
  assertTrue(
    !before.inside.equals(insideAgain),
    "the ground fixtures at the site's anchors to change when the site serves " +
      `other bytes under assets/models/${SUBJECT}.glb, since a mount on ` +
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

/** The isolated world this point is about: the site's anchors, nothing else. */
async function bareSite(h: Harness): Promise<readonly Vec3[]> {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);
  const { site, structure } = await h.snapshot();
  if (structure.members.length !== 0 || structure.ring !== null) {
    fail(
      "an empty structure, so the only thing standing at an anchor is its " +
        "mount (specs/instrumentation.md's `clearStructure`)",
      `${structure.members.length} members and ` +
        `${structure.ring === null ? "no" : "a"} ring stand`,
    );
  }
  assertGreaterThan(
    site.anchors.length,
    0,
    "the anchor nodes the open site fixes, which specs/world.md gives every " +
      "site and specs/assets.md draws a mount at each of",
  );
  return site.anchors;
}

/** Where the build itself says the block of yard holding the anchors is drawn. */
async function anchorRegion(
  h: Harness,
  anchors: readonly Vec3[],
): Promise<Rect> {
  const xs = anchors.map((one) => one.x);
  const zs = anchors.map((one) => one.z);
  const box = {
    minX: Math.min(...xs) - PAD,
    maxX: Math.max(...xs) + PAD,
    minZ: Math.min(...zs) - PAD,
    maxZ: Math.max(...zs) + PAD,
  };
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const x of [box.minX, box.maxX]) {
    for (const y of [Y_LOW, Y_HIGH]) {
      for (const z of [box.minZ, box.maxZ]) {
        const on = await h.project(x, y, z);
        assertTrue(
          on.visible,
          `the corner (${x}, ${y}, ${z}) of the anchors' block of yard to be ` +
            "drawn on the stage at the start camera pose, so this point has a " +
            "picture to read (specs/instrumentation.md)",
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
