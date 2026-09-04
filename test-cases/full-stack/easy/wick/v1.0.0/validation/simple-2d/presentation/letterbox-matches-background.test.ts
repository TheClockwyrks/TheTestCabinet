// presentation/letterbox-matches-background — the bars around the fitted stage
// carry the stage's background color.
//
// WHERE THE THRESHOLD COMES FROM. specs/overview.md ("Units, ticks, the world,
// and the camera"): "The stage has one background color, painted across the
// whole stage before anything else is drawn, and the letterbox bars carry that
// color", and, under What you implement: "src/game.ts also exports BACKGROUND,
// a CSS color string: the stage background. src/main.ts hands it to the engine
// as the color the canvas is cleared to each frame, so the letterbox bars
// around the stage match the night. The seeded stub exports a placeholder;
// replace it with the color your night uses." The color itself is the build's
// ("Wick fixes no palette", specs/ui.md), so what a check decides is that the
// bars really are THAT color once the build's frame has been drawn.
//
// THE WORLD. An isolated playing run (`isolate`) over a surface wider than the
// stage's ratio, so a bar of 160 CSS pixels stands at each side. `playing` is
// the busiest frame the game draws, the world and the HUD together, which is
// the frame most likely to spill past the stage.
//
// WHAT IS READ. Every pixel of the left bar and of the right bar, off the
// canvas the build drew into, against the color BACKGROUND names, resolved by
// painting that string onto a scratch canvas with the same library the engine
// draws with, so any CSS spelling a build chose reads the same way. A build
// whose BACKGROUND is no color at all leaves the bars transparent and fails
// here; one whose render paints outside the stage covers a bar and fails here.
//
// TOLERANCE. None: the bars are filled with one color and nothing else touches
// them, so every channel of every bar pixel matches exactly.

import { createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
// The build's own stage background, which `src/main.ts` hands the engine as the
// color the canvas is cleared to. It is the SUBJECT of this point rather than a
// threshold, which is why it is read from the build rather than restated in
// `constants.ts`: the specification fixes that the bars carry it, and leaves
// which color it is to the build.
import { BACKGROUND } from "../../src/game";

/** A surface 320 CSS pixels wider than the stage's ratio: a bar at each side. */
const CSS_WIDTH = STAGE_W + 320;
const CSS_HEIGHT = STAGE_H;

/** `color` as the canvas library resolves it, or `null` for no color at all. */
function resolve(color: string): [number, number, number, number] | null {
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
  return a === 0 ? null : [r, g, b, a];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ cssWidth: CSS_WIDTH, cssHeight: CSS_HEIGHT });
});

afterEach(() => {
  h?.dispose();
});

it("fills both letterbox bars with the color the build gives the stage", async () => {
  const background = resolve(BACKGROUND);
  if (background === null) {
    fail(
      "BACKGROUND, exported by src/game.ts, to be an opaque CSS color the stage is cleared to",
      BACKGROUND,
    );
  }

  isolate(h);
  await h.frameDraw();
  captureStill(h, "bars");

  const view = h.viewport();
  const bar = Math.round(view.offsetX);
  assertEqual(
    bar > 0,
    true,
    `a left bar on a ${CSS_WIDTH} x ${CSS_HEIGHT} surface, in device pixels`,
  );
  const right = Math.round(view.offsetX + STAGE_W * view.scale);

  // Read off the real context rather than through the stage mapping: a bar is
  // outside the stage, so it has no logical coordinates.
  const bars = [
    { name: "left", pixels: h.ctx.getImageData(0, 0, bar, h.canvas.height) },
    {
      name: "right",
      pixels: h.ctx.getImageData(
        right,
        0,
        h.canvas.width - right,
        h.canvas.height,
      ),
    },
  ];
  for (const { name, pixels } of bars) {
    for (let i = 0; i < pixels.data.length; i += 4) {
      const at = i / 4;
      const found = [
        pixels.data[i],
        pixels.data[i + 1],
        pixels.data[i + 2],
        pixels.data[i + 3],
      ];
      if (found.some((channel, c) => channel !== background[c])) {
        fail(
          `${JSON.stringify(background)}, the color BACKGROUND names (the ${name} bar at column ${at % pixels.width}, row ${Math.floor(at / pixels.width)})`,
          found,
        );
      }
    }
  }
});
