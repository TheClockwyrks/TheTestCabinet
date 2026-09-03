// screens/build-readout-selected-tool-marked — the build screen's tool palette
// marks the selected tool, distinctly from the others.
//
// specs/ui.md § Build: "Its readouts show the site's name, the cost against the
// budget, the tool palette with each tool's binding and the selected tool marked,
// and the tape's step count." specs/controls.md § The build tools: "The selected
// tool decides what a click does", so which tool is marked is what a player reads
// the editor's state off.
//
// THE MARK IS FOUND BY MOVING THE SELECTION, which is what lets a build mark it
// however it likes — a highlight behind the name, a brighter ink, a box, a caret.
// The palette is pictured with the strut tool selected and again with the cable
// tool selected, and each tool's own corner of the screen is compared between the
// two: the strut's and the cable's must both be drawn differently, because the
// mark left one and arrived at the other, and the four tools that were not
// selected either time must be drawn identically, because nothing marked them.
// A build that marked nothing, marked everything, or marked a tool other than the
// selected one fails one of those three.
//
// EACH TOOL'S CORNER is a square around where the build drew that tool's name,
// half as wide as the gap to the nearest other tool's name — so the reading
// follows a palette laid out down the stage or across it, and a mark drawn behind,
// around or beside a name falls inside its own square and outside every other's.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fail } from "../assert";
import { textDraws, toDrawCall, type RecordedOp } from "../case-harness/index";
import { STAGE_H, STAGE_W } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The six tools in binding order, each with the words it may be named by. */
const TOOLS: readonly { of: string; names: readonly string[] }[] = [
  { of: "strut", names: ["strut", "1strut"] },
  { of: "cable", names: ["cable", "2cable"] },
  { of: "rail", names: ["rail", "3rail"] },
  { of: "ring", names: ["ring", "4ring"] },
  { of: "counterweight", names: ["counterweight", "weight", "5weight"] },
  { of: "delete", names: ["delete", "remove", "erase", "6delete"] },
];

/** How much of the gap to the nearest other tool a tool's corner reaches. */
const CORNER = 0.45;

/** A picture of the page, RGBA, four bytes per pixel, row-major. */
interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * The screen layer as this frame drew it: the readouts, over transparency.
 *
 * THE SCREEN LAYER AND NOT THE WHOLE FRAME. The engine draws the yard through
 * WebGL and composites its 2D screen layer over the result, and the readouts this
 * point is about are on that layer. There is no rasterizer for the other half in
 * this project — `validation/host.ts` gives three a WebGL2 context that answers
 * every call and draws nothing — and the yard is not what this point reads.
 */
async function picture(harness: Harness): Promise<Picture> {
  const png = await harness.screenPng();
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

/** Every run of text the last closed frame drew, with where it landed. */
async function frameDraws(harness: Harness) {
  const ops = (await harness.screenOps()) as RecordedOp[];
  return textDraws(ops.map(toDrawCall));
}

/** Letters and digits alone, lowercased. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** How many pixels of a square of the stage the two pictures draw differently. */
function changedIn(
  one: Picture,
  two: Picture,
  at: { x: number; y: number },
  reach: number,
): number {
  const sx = one.width / STAGE_W;
  const sy = one.height / STAGE_H;
  const left = Math.max(Math.round((at.x - reach) * sx), 0);
  const right = Math.min(Math.round((at.x + reach) * sx), one.width - 1);
  const top = Math.max(Math.round((at.y - reach) * sy), 0);
  const bottom = Math.min(Math.round((at.y + reach) * sy), one.height - 1);
  let count = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const i = (y * one.width + x) * 4;
      if (
        one.data[i] !== two.data[i] ||
        one.data[i + 1] !== two.data[i + 1] ||
        one.data[i + 2] !== two.data[i + 2]
      ) {
        count += 1;
      }
    }
  }
  return count;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the palette's mark to the tool that is selected", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.setTool("strut");
  await h.advance(1);

  const draws = await frameDraws(h);
  const drew = JSON.stringify(draws.map((draw) => draw.text));
  const labels = TOOLS.map(({ of, names }) => {
    const label = draws.find((draw) => names.includes(bare(draw.text)));
    if (label === undefined) {
      fail(
        `the tool palette to name the ${of} tool, so the check can look at ` +
          "where that tool is drawn (specs/ui.md § Build)",
        `the build screen drew ${drew}`,
      );
    }
    return label;
  });

  // Half the gap to the nearest other tool: a mark on one tool cannot reach
  // another's square, and a square is as big as the palette's own spacing allows.
  const gap = Math.min(
    ...labels.flatMap((one, at) =>
      labels
        .filter((_, other) => other !== at)
        .map((other) => Math.hypot(one.x - other.x, one.y - other.y)),
    ),
  );
  const reach = gap * CORNER;

  const withStrut = await picture(h);
  await h.capture("build-selected-tool", "The selected tool marked");
  await h.debug.setTool("cable");
  await h.advance(1);
  const withCable = await picture(h);

  const changed = labels.map((label) =>
    changedIn(withStrut, withCable, label, reach),
  );

  for (const [index, tool] of TOOLS.entries()) {
    const marked = tool.of === "strut" || tool.of === "cable";
    if (marked && changed[index] === 0) {
      fail(
        `the palette to draw the ${tool.of} tool differently when it is the ` +
          "selected tool and when it is not, which is what marks it " +
          "(specs/ui.md § Build)",
        `it is drawn identically either way around where it named the tool, ` +
          `at (${labels[index]!.x.toFixed(0)}, ` +
          `${labels[index]!.y.toFixed(0)})`,
      );
    }
    if (!marked && changed[index]! > 0) {
      fail(
        `the palette to leave the ${tool.of} tool as it was when the ` +
          "selection moved from the strut tool to the cable tool, so the " +
          "mark is on the selected tool alone (specs/ui.md § Build)",
        `${changed[index]} pixels around where it named the tool, at ` +
          `(${labels[index]!.x.toFixed(0)}, ${labels[index]!.y.toFixed(0)}), ` +
          "changed with it",
      );
    }
  }
});
