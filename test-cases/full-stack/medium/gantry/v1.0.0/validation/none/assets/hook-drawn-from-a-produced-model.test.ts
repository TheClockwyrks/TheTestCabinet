// assets/hook-drawn-from-a-produced-model — the hook block at the cable's end is
// the committed `hook` model, decoded and drawn.
//
// specs/assets.md § The models: "hook | the hook block at the cable's end", one
// of the eight models the build "produces … commits … and wires in", each
// committed as `assets/models/<model>.glb` under the name that table gives it.
// § What is drawn in code keeps the hoist cable itself on the build's side of the
// line; the block hanging on its end is not.
//
// THE READING IS THE FILE'S CONTENTS. Two pages load the same `dist/`, posed
// identically, one of them served with every response carrying the bytes of
// `assets/models/hook.glb` answered with the bytes of another of the build's own
// committed models. A hook drawn from the produced file is then drawn as that
// other model and the stage at the bob changes; a hook drawn in code does not
// move a pixel.
//
// SUBSTITUTED RATHER THAN WITHHELD, and matched by BYTES rather than by URL, for
// the reasons `ring-drawn-from-a-produced-model` sets out.
//
// THE HOOK IS REACHED THROUGH A RUN, AND POSED CLEAR OF THE CRANE.
// specs/instrumentation.md gives `setBob` and `setAxis`, and specs/rigging.md
// hangs the bob from the trolley on a cable of the hoist axis's length, so the
// bob is posed at the far end of the track and three units down, with the hoist
// axis set to that same three: a pose the cable is already satisfied by, so the
// tick that draws it moves nothing. That puts the block out in the open, four
// units from the slew axis, where nothing else of the crane is drawn.
//
// THE WORLD IS THE CRANE ALONE: no loads and no obstacles, and the tape is one
// grip move, the only axis whose motion "applies no force to anything", so the
// run stays running and nothing in the yard moves between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertGreaterThan, assertTrue, fail } from "../assert";
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

/** The far end of the minimal crane's track, and the cable let out to reach it. */
const TROLLEY_AT = 4;
const HOIST_AT = 3;
const BOB: Vec3 = { x: 4, y: 1, z: 0 };

/**
 * The world box the block's drawing is held inside.
 *
 * specs/assets.md sizes the hook "about `0.6 x 1 x 0.6` units" and says of the
 * part figures that they "are the intent, not a tolerance", so the box reaches
 * two units each way — room for any block a build sculpts to that intent, and for
 * the larger stand-in drawn in its place.
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

it("draws the hook from the committed hook model", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  const at = await poseHook(served);
  const region = await boxRegion(served, at);
  const bands = surrounding(region);
  const before = {
    inside: await shot(served, region),
    outside: await Promise.all(bands.map((band) => shot(served, band.rect))),
  };
  await served.capture("hook", "The hook drawn from its produced model");

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
  await poseHook(substituted);

  assertGreaterThan(
    replaced,
    0,
    "the responses the served site answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a site that never serves that file draws no hook " +
      "from it",
  );

  const spilled: string[] = [];
  for (const [index, band] of bands.entries()) {
    const again = await shot(substituted, band.rect);
    if (!before.outside[index]!.equals(again)) spilled.push(band.where);
  }
  if (spilled.length > 0) {
    fail(
      "the stage outside the block's own extent to be drawn the same " +
        "whichever model the site serves under the hook's file, so that what " +
        "changes inside that extent is the hook (specs/assets.md)",
      `it differs ${spilled.join(", ")}, so this build draws a different yard ` +
        "rather than simply a different block",
    );
  }

  const insideAgain = await shot(substituted, region);
  assertTrue(
    !before.inside.equals(insideAgain),
    "the block at the cable's end to change when the site serves other bytes " +
      `under assets/models/${SUBJECT}.glb, since the hook on screen is that ` +
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

/** The isolated world this point is about, and where the bob came to rest. */
async function poseHook(h: Harness): Promise<Vec3> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setAxis("hoist", HOIST_AT);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  const gap = Math.hypot(
    run.bob.pos.x - BOB.x,
    run.bob.pos.y - BOB.y,
    run.bob.pos.z - BOB.z,
  );
  if (gap > 0.25) {
    fail(
      `the bob to stay within a quarter unit of (${BOB.x}, ${BOB.y}, ${BOB.z}) ` +
        "on the tick after it is posed there on a cable of exactly that " +
        "length, so this point reads a block standing still (specs/rigging.md)",
      `it stands ${gap.toFixed(3)} away, at (${run.bob.pos.x.toFixed(3)}, ` +
        `${run.bob.pos.y.toFixed(3)}, ${run.bob.pos.z.toFixed(3)})`,
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
