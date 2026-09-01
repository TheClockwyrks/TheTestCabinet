// presentation/text-boxes — where a frame's runs of text really landed, as
// boxes. PRIVATE to `presentation/`.
//
// The shared harness's `textDraws` reads each run's transform-mapped ANCHOR,
// which is all the copy checks and `./hud.ts` need. `text-legible` needs the
// run's BOX: it weighs the pixels a run painted against the background around
// them, and it cannot find those pixels without knowing where the glyphs are.
//
// SO EVERY RUN IS MEASURED IN THE PAGE, with the build's own loaded fonts,
// through `measureText`'s actual bounding box — under the `font`, `textAlign`
// and `textBaseline` in force at the call, which the canvas saves and restores
// alongside the transform exactly as it does the transform. The box's corners
// are then mapped through that transform, so a readout drawn from a translated
// HUD corner lands where it landed on screen.

import type { DrawCall, Harness } from "../harness";

/** One run of text a frame drew, and the box it occupies in stage units. */
export interface TextBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * The run's own anchor, mapped through the transform in force.
   *
   * Where the build ASKED for the run, rather than where its glyphs reached: the
   * reading that says which part of the stage a run belongs to. `specs/ui.md`
   * puts the five readouts inside the HUD bar and `specs/strait.md` puts the bar
   * at `y` in `[0, HUD_H]`, so a run anchored there is a readout and one anchored
   * below is a screen's own text, whatever its descenders do.
   */
  baseline: number;
}

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The context's own defaults, in force until the build sets its own. */
const DEFAULT_FONT = "10px sans-serif";
const DEFAULT_ALIGN = "start";
const DEFAULT_BASELINE = "alphabetic";

interface TextState {
  matrix: Matrix;
  font: string;
  align: string;
  baseline: string;
}

interface RawDraw {
  text: string;
  x: number;
  y: number;
  state: TextState;
}

/** What the page measured one run at: offsets from its anchor, unscaled. */
interface Measured {
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function numbers(args: unknown[], count: number): number[] | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as number[])
    : null;
}

/**
 * Every text run the frame drew, with the transform and the text state in force
 * at its call — the walk the harness's `textDraws` does, widened to carry
 * `font`, `textAlign` and `textBaseline`, which `save`/`restore` stack exactly
 * as the transform does.
 */
function rawDraws(calls: readonly DrawCall[]): RawDraw[] {
  const draws: RawDraw[] = [];
  const stack: TextState[] = [];
  let current: TextState = {
    matrix: IDENTITY,
    font: DEFAULT_FONT,
    align: DEFAULT_ALIGN,
    baseline: DEFAULT_BASELINE,
  };
  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "font" && typeof call.value === "string") {
        current = { ...current, font: call.value };
      } else if (
        call.property === "textAlign" &&
        typeof call.value === "string"
      ) {
        current = { ...current, align: call.value };
      } else if (
        call.property === "textBaseline" &&
        typeof call.value === "string"
      ) {
        current = { ...current, baseline: call.value };
      }
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
    } else if (method === "restore") {
      const popped = stack.pop();
      if (popped !== undefined) current = popped;
    } else if (method === "translate") {
      const v = numbers(args, 2);
      if (v) {
        current = {
          ...current,
          matrix: multiply(current.matrix, [1, 0, 0, 1, v[0], v[1]]),
        };
      }
    } else if (method === "scale") {
      const v = numbers(args, 2);
      if (v) {
        current = {
          ...current,
          matrix: multiply(current.matrix, [v[0], 0, 0, v[1], 0, 0]),
        };
      }
    } else if (method === "rotate") {
      const v = numbers(args, 1);
      if (v) {
        const c = Math.cos(v[0]);
        const sn = Math.sin(v[0]);
        current = {
          ...current,
          matrix: multiply(current.matrix, [c, sn, -sn, c, 0, 0]),
        };
      }
    } else if (method === "transform") {
      const v = numbers(args, 6);
      if (v) {
        current = { ...current, matrix: multiply(current.matrix, v as Matrix) };
      }
    } else if (method === "setTransform") {
      const v = numbers(args, 6);
      if (v) current = { ...current, matrix: v as Matrix };
      else if (args.length === 0) current = { ...current, matrix: IDENTITY };
      else if (typeof args[0] === "object" && args[0] !== null) {
        const m = args[0] as Record<string, unknown>;
        const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
        if (parts.every((p) => typeof p === "number")) {
          current = { ...current, matrix: parts as Matrix };
        }
      }
    } else if (method === "resetTransform") {
      current = { ...current, matrix: IDENTITY };
    } else if (method === "fillText" || method === "strokeText") {
      const [text] = args;
      const at = numbers(args.slice(1), 2);
      if (typeof text !== "string" || at === null) continue;
      draws.push({ text, x: at[0], y: at[1], state: current });
    }
  }
  return draws;
}

/** The box each of the frame's runs of text occupies, in logical stage units. */
export async function measuredTextBoxes(
  h: Harness,
  calls: readonly DrawCall[],
): Promise<TextBox[]> {
  const draws = rawDraws(calls).filter((draw) => draw.text.trim() !== "");
  if (draws.length === 0) return [];

  const measured = (await h.page.evaluate(
    (items) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx === null)
        throw new Error("floe: no 2D context to measure text in");
      return items.map((item) => {
        ctx.font = item.font;
        ctx.textAlign = item.align as CanvasTextAlign;
        ctx.textBaseline = item.baseline as CanvasTextBaseline;
        const metrics = ctx.measureText(item.text);
        // A conservative fallback where a browser reports no actual box: the
        // full advance width split by the alignment, and the font's size above
        // the anchor with half of it below.
        const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(item.font);
        const size = sizeMatch === null ? 10 : Number(sizeMatch[1]);
        const width = metrics.width;
        const centred = item.align === "center";
        const trailing = item.align === "right" || item.align === "end";
        return {
          left:
            metrics.actualBoundingBoxLeft ??
            (centred ? width / 2 : trailing ? width : 0),
          right:
            metrics.actualBoundingBoxRight ??
            (centred ? width / 2 : trailing ? 0 : width),
          ascent: metrics.actualBoundingBoxAscent ?? size,
          descent: metrics.actualBoundingBoxDescent ?? size / 2,
        };
      });
    },
    draws.map(({ text, state }) => ({
      text,
      font: state.font,
      align: state.align,
      baseline: state.baseline,
    })),
  )) as Measured[];

  return draws.map((draw, index) => {
    const m = measured[index];
    const corners: [number, number][] = [
      [draw.x - m.left, draw.y - m.ascent],
      [draw.x + m.right, draw.y - m.ascent],
      [draw.x - m.left, draw.y + m.descent],
      [draw.x + m.right, draw.y + m.descent],
    ];
    const [a, b, c, d, e, f] = draw.state.matrix;
    const xs = corners.map(([x, y]) => a * x + c * y + e);
    const ys = corners.map(([x, y]) => b * x + d * y + f);
    return {
      text: draw.text,
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
      baseline: b * draw.x + d * draw.y + f,
    };
  });
}
