// screens/build-draws-the-obstacles — the build screen draws an obstacle as the
// box it occupies.
//
// specs/ui.md, "Build": "`build` shows the yard through the camera: the ground,
// the lattice and envelope aids, the anchors, the obstacles, the loads at their
// starting poses, the pads, and the structure as built". An obstacle is a box —
// specs/world.md and the site tables give each one as a minimum corner and a
// size, and specs/structure.md refuses anything that reaches inside that box —
// so drawing an obstacle is drawing that box where the camera puts it.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws an obstacle as
// is entirely its own: a solid, a wireframe, a hatched slab. What is fixed is
// that adding one CHANGES the picture, and that the change lands where the box
// is. So the yard is emptied to nothing — no structure, no loads, no obstacles —
// the frame is photographed, one obstacle is posed with the camera untouched,
// and the frame is photographed again.
//
// WHERE THE BOX IS ON THE STAGE IS THE BUILD'S OWN ANSWER. The eight corners are
// put through `project`, which specs/instrumentation.md defines as "Where
// `(x, y, z)` is drawn, through the camera as it stands", so the extent this
// check holds the change to is the one the build itself says the box occupies. A
// validator that measured against a camera of its own would be grading its own
// arithmetic.
//
// THE MARGIN IS AN HONEST TOLERANCE, not a fudge. The corner points are the
// box's mathematical corners, and a build draws a solid with an edge of some
// stroke width, may mark it as an obstacle rather than a plain block, and is free
// to shade the ground under it — so a few logical pixels of the drawing fall
// outside the projected hull. The margin is a quarter of the box's own drawn
// size, which is room for all of that and still far short of anywhere else in
// the yard: everything beyond it has to be untouched, and that is what tells a
// box drawn where the obstacle stands from a marker drawn in the readouts or a
// block drawn somewhere else.
//
// The picture is compared as PNG bytes off the page rather than as pixels off a
// canvas: an engineless build draws the yard through WebGL, so the only place the
// yard and the screen layer exist together is the page's own composited frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/**
 * The obstacle: a box standing clear of the anchors, well inside the frame at
 * the start camera pose, and clear of the stage's edges.
 */
const MIN: Vec3 = { x: 4, y: 0, z: -2 };
const SIZE: Vec3 = { x: 2, y: 4, z: 4 };

/** Slack around the projected hull, as a share of the box's own drawn size. */
const MARGIN_SHARE = 0.25;

/** A rectangle of the stage, in logical units. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a posed obstacle inside the box's projected extent", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen opening a site shows");
  assertEqual(
    posed.site.obstacles.length,
    0,
    "the obstacles standing in the emptied yard, before the one this point " +
      "poses",
  );

  // Where the build draws the box, from the build's own projection.
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [0, SIZE.x]) {
    for (const dy of [0, SIZE.y]) {
      for (const dz of [0, SIZE.z]) {
        const at = await h.project(MIN.x + dx, MIN.y + dy, MIN.z + dz);
        assertTrue(
          at.visible,
          `the box corner (${MIN.x + dx}, ${MIN.y + dy}, ${MIN.z + dz}) to be ` +
            "drawn on the stage at the start camera pose, so this point has a " +
            "picture to read (specs/instrumentation.md)",
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
  // Everything the box's drawing may not reach: the stage either side of it,
  // and the stage above and below it between those two.
  const outside: { where: string; rect: Rect }[] = [
    { where: "left of the box", rect: { x: 0, y: 0, width: near.left, height: STAGE_H } },
    {
      where: "right of the box",
      rect: { x: near.right, y: 0, width: STAGE_W - near.right, height: STAGE_H },
    },
    {
      where: "above the box",
      rect: { x: near.left, y: 0, width: near.right - near.left, height: near.top },
    },
    {
      where: "below the box",
      rect: {
        x: near.left,
        y: near.bottom,
        width: near.right - near.left,
        height: STAGE_H - near.bottom,
      },
    },
  ].filter(({ rect }) => rect.width >= 1 && rect.height >= 1);
  assertEqual(
    outside.length,
    4,
    "the four bands of stage outside the box's projected extent, which this " +
      "point needs the box to stand clear of the stage's edges for",
  );

  // The canvas's place on the page, so a logical rectangle names a real one.
  const fit = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as Rect | null;
  assertTrue(fit !== null, "a <canvas> on the page for the build to draw in");

  const shot = async (rect: Rect): Promise<Buffer> => {
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
  };

  const before = {
    inside: await shot(inside),
    outside: await Promise.all(outside.map(({ rect }) => shot(rect))),
  };

  await h.debug.addObstacle(MIN.x, MIN.y, MIN.z, SIZE.x, SIZE.y, SIZE.z);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).site.obstacles.length,
    1,
    "the obstacles standing in the yard once one is posed",
  );

  const afterInside = await shot(inside);
  assertTrue(
    !before.inside.equals(afterInside),
    "the picture inside the box's projected extent to change when an obstacle " +
      "is posed there, since the build screen shows the yard's obstacles " +
      "(specs/ui.md)",
  );

  const spilled: string[] = [];
  for (const [index, band] of outside.entries()) {
    const again = await shot(band.rect);
    if (!before.outside[index]!.equals(again)) spilled.push(band.where);
  }
  assertEqual(
    spilled.join(", "),
    "",
    `the stage more than ${margin.toFixed(1)} logical pixels outside the ` +
      "box's projected extent, which posing an obstacle may not change " +
      "because an obstacle is drawn as the box it occupies (specs/ui.md)",
  );

  await h.capture("obstacle-drawn", "A posed obstacle drawn in the yard");
});
