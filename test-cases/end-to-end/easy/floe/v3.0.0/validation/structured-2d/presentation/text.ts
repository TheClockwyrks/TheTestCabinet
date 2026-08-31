// presentation — where a frame's runs of text really landed, as boxes. PRIVATE
// to `presentation/`.
//
// The shared harness's `drawnTextSpans` places each run's transform-mapped
// ANCHOR and its horizontal extent, which is all the copy checks and `./hud.ts`
// need. `text-legible` needs the run's BOX: it weighs the pixels a run painted
// against the background around them, and it cannot find those pixels without
// knowing how far above and below the baseline the glyphs sit.
//
// SO EVERY RUN IS MEASURED, under the `font` and `textBaseline` in force at the
// call. The recorder captures every property set the render made, in order, and
// the canvas stacks those two on `save`/`restore` exactly as it stacks the
// transform — so the walk below replays them and hands each run the state its own
// call drew under. The measurement itself is `measureText`'s actual bounding box,
// taken on a scratch canvas of the same implementation the build drew on, so a
// build that set its text from the top, the middle or the bottom is boxed where
// its glyphs actually are rather than where an alphabetic baseline would have put
// them. A build whose baseline is `top` and whose box was assumed alphabetic
// would be read as having painted nothing at all, which is the worse of the two
// errors this could make.
//
// The horizontal extent is the harness's own, because the harness measured the
// run on the REAL context at the moment of the call and applied the `textAlign`
// in force there.
//
// NOTHING HERE FIXES A BOUND A VERDICT TURNS ON. How far a glyph must sit from
// the ground behind it, and how much of a box must, are `text-legible`'s own
// figures, stated there.

import { createCanvas } from "@napi-rs/canvas";
import { drawnTextSpans, type DrawCall, type Harness } from "../harness";

/** The canvas's own defaults, in force until the build sets its own. */
const DEFAULT_FONT = "10px sans-serif";
const DEFAULT_BASELINE = "alphabetic";

/** One run of text a frame drew, and the box its glyphs occupy in stage units. */
export interface TextBox {
  text: string;
  /** The box, in stage units. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The text state a run was drawn under. */
interface TextState {
  font: string;
  baseline: string;
}

/** What one accepted text call was drawn under. */
interface RunState {
  state: TextState;
  /** The vertical scale from the call's own space to stage units. */
  vertical: number;
}

/**
 * The state each ACCEPTED text call was drawn under, in the same order and under
 * the same acceptance the harness's `drawnTextSpans` uses, so entry `i` here
 * belongs to span `i` there.
 */
function statesOfRuns(calls: readonly DrawCall[], scale: number): RunState[] {
  const runs: RunState[] = [];
  const stack: TextState[] = [];
  let current: TextState = { font: DEFAULT_FONT, baseline: DEFAULT_BASELINE };

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "font" && typeof call.value === "string") {
        current = { ...current, font: call.value };
      } else if (
        call.property === "textBaseline" &&
        typeof call.value === "string"
      ) {
        current = { ...current, baseline: call.value };
      }
      continue;
    }
    if (call.method === "save") {
      stack.push(current);
      continue;
    }
    if (call.method === "restore") {
      const popped = stack.pop();
      if (popped !== undefined) current = popped;
      continue;
    }
    // The harness's own acceptance, so the two lists line up run for run.
    if (call.text === undefined) continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || typeof ax !== "number") continue;
    if (typeof ay !== "number") continue;
    const m = call.text.transform;
    runs.push({ state: current, vertical: Math.hypot(m.c, m.d) / scale });
  }
  return runs;
}

/** How far a run's glyphs reach above and below its anchor, in its own units. */
interface Extent {
  ascent: number;
  descent: number;
}

/** The `px` size of a CSS font shorthand, or `null` where it names none. */
function fontSize(font: string): number | null {
  const found = /(\d+(?:\.\d+)?)px/.exec(font);
  return found === null ? null : Number(found[1]);
}

/** The scratch context every measurement is taken on. */
let scratch: ReturnType<ReturnType<typeof createCanvas>["getContext"]> | null =
  null;

/**
 * How far `text` reaches above and below its anchor under `state`.
 *
 * `measureText`'s actual bounding box accounts for the `textBaseline` in force,
 * so this is where the glyphs are rather than where an assumed baseline would put
 * them. A font the host reports no box for falls back to the font's own size
 * above the anchor and a quarter of it below — deliberately generous, because a
 * box too small reads legible text as invisible.
 */
function extentOf(text: string, state: TextState): Extent {
  scratch ??= createCanvas(1, 1).getContext("2d");
  const ctx = scratch;
  ctx.font = state.font;
  ctx.textBaseline = state.baseline as CanvasTextBaseline;
  const metrics = ctx.measureText(text);
  const size = fontSize(state.font) ?? 10;
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) {
    return { ascent: size, descent: size / 4 };
  }
  return { ascent, descent };
}

/**
 * Every run of text the last frame drew, with the box its glyphs occupy.
 *
 * The frame is whatever `h.calls` currently holds, so a caller runs
 * `renderFrame` first and reads the frame it ran.
 */
export function textBoxes(h: Harness): TextBox[] {
  const view = h.engine.viewport();
  const spans = drawnTextSpans(h);
  const runs = statesOfRuns(h.calls, view.scale);

  return spans.map((span, index) => {
    const run = runs[index] ?? {
      state: { font: DEFAULT_FONT, baseline: DEFAULT_BASELINE },
      vertical: 1,
    };
    const { ascent, descent } = extentOf(span.text, run.state);
    return {
      text: span.text,
      left: span.left,
      right: span.right,
      top: span.y - ascent * run.vertical,
      bottom: span.y + descent * run.vertical,
    };
  });
}
