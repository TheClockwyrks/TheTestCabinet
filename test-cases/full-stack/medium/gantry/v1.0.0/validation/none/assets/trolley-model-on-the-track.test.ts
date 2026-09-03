// assets/trolley-model-on-the-track — the carriage is drawn at the trolley's own
// position along the track, not somewhere fixed on it.
//
// specs/assets.md § The models says where the model goes: "The game draws each
// model wherever its subject is: … the trolley on the track at the trolley
// position …". specs/structure.md fixes that position: "The trolley's position is
// its distance along the track from that origin, from `0` to the track's length,
// and the trolley begins every run at `0`", the origin being "the end nearer the
// slew axis". specs/state.md reports the point the carriage stands at as the run's
// pivot, "the point the cable hangs from, at the most recent tick's geometry",
// which is the build's own answer to where its carriage is.
//
// THE CARRIAGE IS DRIVEN TO THE FAR END OF THE TRACK, `4` units from the origin
// on the minimal crane's single rail. A build that drew its carriage at the
// track's start, or at the slew axis, or anywhere else fixed, draws nothing where
// the trolley actually stands — and the whole of the stage away from that point
// is read, so the start of the track is read too.
//
// WHERE THE CARRIAGE IS DRAWN IS READ BY SERVING A DIFFERENT MODEL UNDER ITS
// FILE. Moving the trolley moves the cable and the hook with it and turns the
// run's readouts over, so the difference between two trolley values says nothing
// about the carriage alone. Two pages of the same build, posed identically at one
// trolley value, served the same in every respect but the bytes under
// `assets/models/trolley.glb`, differ in exactly the pixels the trolley model
// draws.
//
// THE BOB IS POSED STILL under the carriage on a cable of exactly the hoist
// axis's length, so nothing swings between the two pages' readings, and the world
// is the crane alone: no loads, no obstacles, and a tape of one grip move, the
// only axis whose motion "applies no force to anything" (specs/rigging.md).

import { afterEach, beforeEach, it } from "vitest";
import type { BrowserContext } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertTrue, fail } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, STAGE_H, STAGE_W } from "../constants";
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
const SUBJECT = "trolley";
const STAND_IN = "hook";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** The far end of the minimal crane's track, four units from its origin. */
const TROLLEY_AT = 4;

/** Where the bob is parked: straight under the carriage, at the cable's length. */
const BOB: Vec3 = { x: 4, y: 4 - HOIST_START, z: 0 };

/**
 * How far around the carriage's point its drawing is held.
 *
 * specs/assets.md sizes the trolley "about `1.5 x 1 x 1.5` units" and says of the
 * part figures that they "are the intent, not a tolerance", so the box reaches
 * two units each way — room for any carriage a build sculpts to that intent, and
 * for the stand-in drawn in its place, while still leaving the track's origin
 * four units outside it.
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

it("draws the trolley at the point on the track the trolley axis stands at", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    !subject.equals(standIn),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  const at = await poseCarriage(served);
  const region = await boxRegion(served, at);
  const bands = surrounding(region);
  const before = {
    inside: await shot(served, region),
    outside: await Promise.all(bands.map((band) => shot(served, band.rect))),
  };
  await served.capture(
    "trolley",
    "The trolley drawn at its position along the track",
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
  await poseCarriage(substituted);

  const spilled: string[] = [];
  for (const [index, band] of bands.entries()) {
    const again = await shot(substituted, band.rect);
    if (!before.outside[index]!.equals(again)) spilled.push(band.where);
  }
  if (spilled.length > 0) {
    fail(
      `the trolley model drawn within ${HALF} units of the point the trolley ` +
        `axis stands at, (${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ` +
        `${at.z.toFixed(2)}), so serving other bytes under ` +
        `assets/models/${SUBJECT}.glb changes nothing elsewhere on the stage ` +
        "(specs/assets.md, specs/structure.md)",
      `the stage changed ${spilled.join(", ")} as well, so the carriage is ` +
        "drawn somewhere other than where the trolley stands",
    );
  }

  const insideAgain = await shot(substituted, region);
  assertTrue(
    !before.inside.equals(insideAgain),
    "the trolley model to be drawn at the point on the track the trolley axis " +
      "stands at, four units from the track's origin, rather than at the " +
      "origin the run started it at (specs/assets.md, specs/structure.md)",
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

/** The isolated world this point is about, and where the carriage stands. */
async function poseCarriage(h: Harness): Promise<Vec3> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  if (Math.abs(run.axes.trolley.value - TROLLEY_AT) > 1e-6) {
    fail(
      `the trolley axis to stand at ${TROLLEY_AT} along the track after it is ` +
        "posed there, which specs/instrumentation.md's `setAxis` establishes",
      `it reads ${run.axes.trolley.value}`,
    );
  }
  return run.pivot;
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
            "carriage's box to be drawn on the stage at the start camera " +
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
