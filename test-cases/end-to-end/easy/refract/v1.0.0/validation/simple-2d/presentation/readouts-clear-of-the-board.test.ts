// Refract — presentation/readouts-clear-of-the-board: the readouts sit clear
// of the board.
//
// specs/ui.md: the mode's readouts "sit clear of the board, whose extent is
// given in specs/board.md" — on the largest board, cell centers spanning
// x 352..928 and y 152..632, widened by NODE_R (30) on every side. The check
// poses the 7x6 board GEO_7X6 in each mode and holds every text draw of one
// rendered frame outside that box, so no heading, hint, or progress readout
// overlaps a node or a beam on the board sizes where space is tightest.
//
// WHERE A TEXT DRAW'S BOUNDS COME FROM. The harness records every context
// call: each fillText/strokeText carries the transform, measured width, and
// alignment at the moment of the call, which places the run horizontally in
// logical units (as drawnTextSpans does). The vertical extent is this suite's
// own reading: the context's font size and textBaseline are tracked through
// the recorded property sets (save/restore included), and the run is given a
// generous em box about its baseline — so the bounds err toward overlap,
// never away from it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
  boardExtent,
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  startCampaign,
  startCascade,
  type Harness,
} from "../harness";

/** One rendered run of text, boxed in logical units. */
interface TextBounds {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The pixel size in a CSS font string, or the canvas default of 10. */
function fontPx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match === null ? 10 : Number(match[1]);
}

/**
 * Every text draw recorded at index `from` or later, boxed in logical units.
 *
 * The whole call history is walked so the context's font and textBaseline are
 * known at every draw — a frame that never re-sets them inherits them from an
 * earlier one, and save/restore is honoured — but only the draws of the frame
 * under test (from `from`) are returned.
 */
function textBoundsFrom(from: number): TextBounds[] {
  const view = h.engine.viewport();
  let font = "10px sans-serif";
  let baseline = "alphabetic";
  const saved: { font: string; baseline: string }[] = [];
  const bounds: TextBounds[] = [];

  h.calls.forEach((call, index) => {
    if (call.kind === "set") {
      if (call.property === "font" && typeof call.value === "string") {
        font = call.value;
      }
      if (call.property === "textBaseline" && typeof call.value === "string") {
        baseline = call.value;
      }
      return;
    }
    if (call.method === "save") {
      saved.push({ font, baseline });
      return;
    }
    if (call.method === "restore") {
      const popped = saved.pop();
      if (popped !== undefined) ({ font, baseline } = popped);
      return;
    }
    if (call.text === undefined || index < from) return;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || typeof ax !== "number") return;
    if (typeof ay !== "number") return;

    // The anchor in logical units, through the transform held at the call.
    const { transform: m, width, textAlign } = call.text;
    const deviceX = m.a * ax + m.c * ay + m.e;
    const deviceY = m.b * ax + m.d * ay + m.f;
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;
    const w = (width * Math.hypot(m.a, m.b)) / view.scale;
    const before =
      textAlign === "center"
        ? w / 2
        : textAlign === "right" || textAlign === "end"
          ? w
          : 0;

    // A generous em box about the baseline, under the vertical scale the
    // transform applies.
    const size = (fontPx(font) * Math.hypot(m.c, m.d)) / view.scale;
    let top: number;
    let bottom: number;
    switch (baseline) {
      case "top":
      case "hanging":
        top = y;
        bottom = y + size;
        break;
      case "middle":
        top = y - size / 2;
        bottom = y + size / 2;
        break;
      case "bottom":
      case "ideographic":
        top = y - size;
        bottom = y;
        break;
      default:
        // alphabetic: a full ascent above the baseline, a descent below.
        top = y - 0.8 * size;
        bottom = y + 0.25 * size;
    }
    bounds.push({ text, left: x - before, right: x - before + w, top, bottom });
  });
  return bounds;
}

/** Every text draw of the next rendered frame sits outside the 7x6 extent. */
async function assertReadoutsClear(mode: string): Promise<void> {
  const from = h.calls.length;
  await h.advance(1);
  if (mode === "campaign") captureStill(h, "playing");

  const drawn = textBoundsFrom(from);
  assertGreaterThan(
    drawn.length,
    0,
    `the ${mode} playing screen draws its readouts (specs/ui.md)`,
  );

  const extent = boardExtent(7, 6);
  for (const box of drawn) {
    const overlaps =
      box.left < extent.x1 &&
      box.right > extent.x0 &&
      box.top < extent.y1 &&
      box.bottom > extent.y0;
    if (overlaps) {
      fail(
        `every ${mode} text draw clear of the 7x6 board's extent — ` +
          `x ${extent.x0}..${extent.x1}, y ${extent.y0}..${extent.y1}, the ` +
          "outermost cell centers widened by NODE_R (30) " +
          "(specs/ui.md: the readouts sit clear of the board)",
        {
          text: box.text,
          left: Math.round(box.left),
          right: Math.round(box.right),
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
        },
      );
    }
  }
}

it("keeps every text draw clear of a posed 7x6 board in campaign", async () => {
  await resetTo(h, 1);
  await startCampaign(h);
  await loadBoard(h, GEO_7X6);
  await assertReadoutsClear("campaign");
});

it("keeps every text draw clear of a posed 7x6 board in cascade", async () => {
  await resetTo(h, 1);
  await startCascade(h);
  await loadBoard(h, GEO_7X6);
  await assertReadoutsClear("cascade");
});
