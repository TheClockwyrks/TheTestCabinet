// presentation/letterbox-matches-background — the bars around the fitted stage
// carry the stage's background colour.
//
// WHERE THE FIGURES COME FROM. `specs/overview.md`, "Units, ticks, the world,
// and the camera": "the letterbox bars carry the stage's background color", and
// under What you implement: "`src/game.ts` also exports `BACKGROUND`, a CSS
// color string: the stage background. `src/main.ts` hands it to the engine as
// the color the canvas is cleared to each frame, so the letterbox bars around
// the stage match the night." Which colour it is belongs to the build ("Wick
// fixes no palette, no font, no layout", `specs/ui.md`), so what is decided
// here is that the bars really are THAT colour once the build's frame has been
// drawn.
//
// WHY `BACKGROUND` IS READ OFF THE BUILD. It is the SUBJECT of this point
// rather than a threshold. The specification fixes that the bars carry it and
// leaves the colour open, so the only honest reading of "the stage's background
// color" is the string the build exports under the name the specification gives
// it, resolved by painting it onto a scratch canvas with the same library the
// engine draws through, so any CSS spelling reads the same way.
//
// THE BOUND. None. The engine clears the canvas to one colour and the stage's
// own picture is confined to the fitted box, so every channel of every bar
// pixel matches exactly. A build whose `BACKGROUND` is no colour at all leaves
// the bars transparent and fails; one whose render paints past the stage covers
// a bar and fails.
//
// THE WORLD, AND WHY. An isolated `playing` run over a surface 320 CSS pixels
// wider than the stage, so a bar stands at each side. `playing` is the busiest
// frame the game draws, the world and the HUD together, and so the frame most
// likely to spill past the stage.

import { createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
// The build's own stage background, which `src/main.ts` hands the engine as the
// colour the canvas is cleared to each frame.
import { BACKGROUND } from "../../src/game";

/** A surface 320 CSS pixels wider than the stage: a bar at each side. */
const CSS_WIDTH = STAGE_W + 320;
const CSS_HEIGHT = STAGE_H;

/** `color` as the canvas library resolves it, or `null` for no colour at all. */
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
  const { data } = into.getImageData(0, 0, 1, 1);
  return data[3] === 0 ? null : [data[0], data[1], data[2], data[3]];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ cssWidth: CSS_WIDTH, cssHeight: CSS_HEIGHT });
});

afterEach(() => {
  h.dispose();
});

it("fills both letterbox bars with the colour the build gives the stage", async () => {
  const background = resolve(BACKGROUND);
  if (background === null) {
    fail(
      "BACKGROUND, exported by src/game.ts, to be an opaque CSS colour the " +
        "stage is cleared to",
      BACKGROUND,
    );
  }

  isolate(h);
  await h.frameDraw();
  captureStill(h, "bars");

  const view = h.viewport();
  const bar = Math.round(view.offsetX);
  assertTrue(
    bar > 0,
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
          `${JSON.stringify(background)}, the colour BACKGROUND names (the ` +
            `${name} bar at column ${at % pixels.width}, row ` +
            `${Math.floor(at / pixels.width)})`,
          found,
        );
      }
    }
  }
});
