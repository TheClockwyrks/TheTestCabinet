// presentation/letterbox-matches-background — the bars around the fitted stage
// carry the stage's own background colour.
//
// WHERE THE THRESHOLD COMES FROM. `specs/overview.md` — "Units, ticks, the world,
// and the camera": "The stage has one background color, painted across the whole
// stage before anything else is drawn, and the letterbox bars carry that color."
// The colour itself is the build's, since "Wick fixes no palette, no font, no
// layout, and no styling for any screen" (`specs/ui.md`), so what a check decides
// is that the bars really are THAT colour rather than which colour it is.
//
// WHERE THE COLOUR IS READ FROM. The frame's own opening paint, which is the
// clause the reading rests on: the background is "painted across the whole stage
// BEFORE ANYTHING ELSE is drawn". An engineless build exports nothing a check
// could ask, so that opening paint is the only place the stage's background
// colour exists — the run of fills a frame opens with, each covering the whole
// stage, before it draws anything smaller. `stageBackground` in `./fit` reads the
// colour left standing at the end of that run, so a build that clears to one
// colour and paints its background over it is read at the background rather than
// at the clear. A frame that opens with no such fill has no background colour to
// carry, which is what this point fails on.
//
// WHERE THE BARS ARE. The seeded `index.html`, which `specs/overview.md` lists
// under "What stays as it is" ("the page and the canvas the stage is fitted
// into"), sizes the canvas `100vw x 100vh`. The window is `320` CSS pixels wider
// than the stage's ratio, so the fit leaves a `160`-pixel bar at each side, and
// every pixel of both is read off the canvas the build drew.
//
// WHY `playing`. It is the busiest frame the game draws, the world and the HUD
// together, so it is the frame most likely to spill past the stage; and the night
// is emptied first, so nothing but the build's own layout can reach a bar.
//
// THE TOLERANCE. `SAME_COLOR_TOL`, two units of Euclidean RGB distance, which is
// one channel of 8-bit rounding on all three at once: the bar's colour and the
// colour the fill named both come back through a canvas. The alpha is exact — a
// bar that is not fully opaque is not carrying a colour at all.

import { createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, it } from "vitest";
import { SAME_COLOR_TOL, STAGE_H, STAGE_W } from "../constants";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  isolate,
  rgbOf,
  type Harness,
  type Pixel,
} from "../harness";
import { barsOf, stageBackground } from "./fit";

/** A window 320 CSS pixels wider than the stage's ratio: a 160-pixel bar a side. */
const CSS_WIDTH = STAGE_W + 320;
const CSS_HEIGHT = STAGE_H;

/** `color` as a canvas resolves it, or `null` when it names no colour at all. */
function resolve(color: string): Pixel | null {
  const scratch = createCanvas(1, 1);
  const into = scratch.getContext("2d");
  into.clearRect(0, 0, 1, 1);
  try {
    into.fillStyle = color;
  } catch {
    return null;
  }
  into.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = into.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : [r as number, g as number, b as number, a as number];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ cssWidth: CSS_WIDTH, cssHeight: CSS_HEIGHT });
});

afterEach(async () => {
  await h.dispose();
});

it("fills every letterbox bar with the colour the frame gives the stage", async () => {
  await isolate(h);
  await h.step(1);
  const view = h.viewport();
  await captureStill(h, "bars");

  const named = stageBackground(await h.lastCalls(), view);
  if (named === null) {
    fail(
      "the playing frame to open by painting the whole stage one colour, " +
        "which is the stage's background colour the bars carry " +
        "(specs/overview.md)",
      "no opening fill covering the stage, or one whose style is no colour",
    );
  }
  const background = resolve(named);
  if (background === null) {
    fail(
      `an opaque colour for the stage's background (specs/overview.md)`,
      named,
    );
  }
  assertEqual(
    background[3],
    255,
    "the alpha of the colour the stage's background is painted with, which a " +
      "bar carries opaquely (specs/overview.md)",
  );

  const bars = barsOf(view);
  assertGreaterThan(
    bars.length,
    0,
    `letterbox bars on a ${CSS_WIDTH} x ${CSS_HEIGHT} window, which is wider ` +
      "than the stage's 16:9 (specs/overview.md)",
  );
  for (const bar of bars) {
    const rect = await h.pixelRect(bar.x, bar.y, bar.width, bar.height);
    let worst = 0;
    let at = 0;
    let seen: Pixel = [0, 0, 0, 0];
    for (let index = 0; index < rect.data.length; index += 4) {
      const pixel: Pixel = [
        rect.data[index] as number,
        rect.data[index + 1] as number,
        rect.data[index + 2] as number,
        rect.data[index + 3] as number,
      ];
      const gap =
        pixel[3] === background[3]
          ? colorDistance(rgbOf(pixel), rgbOf(background))
          : Number.POSITIVE_INFINITY;
      if (gap > worst) {
        worst = gap;
        at = index / 4;
        seen = pixel;
      }
    }
    if (worst > SAME_COLOR_TOL) {
      fail(
        `every pixel of the ${bar.name} bar to carry the stage's background ` +
          `colour ${JSON.stringify(background)} (specs/overview.md)`,
        `${JSON.stringify(seen)} at column ${at % rect.width}, row ${Math.floor(at / rect.width)} of the bar`,
      );
    }
  }
});
