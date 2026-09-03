/**
 * The debug overlay: a read-only window onto values the *game* names, onto the
 * engine's own frame timing, and onto what the renderer cost to draw the last
 * frame.
 *
 * The engine cannot know what is worth watching in someone else's simulation, so it
 * does not guess: a game registers named sources and the engine owns everything
 * around them — the panel, the toggle key, and the frame metrics. Sources are
 * evaluated on every read rather than sampled at registration, so pressing the
 * toggle shows the state the simulation is in on the frames the panel is drawn over.
 *
 * Three rules follow from "read-only", and all three are enforced here rather than
 * left to the game's good behaviour:
 *
 * - A source that throws is contained. A diagnostic exists to explain a failure, so
 *   it must never be the cause of one — a throwing source yields a reading carrying
 *   its message and no value, and the rest of the panel draws normally.
 * - {@link Diagnostics.draw} saves and restores the 2D context around everything it
 *   does. The overlay draws *after* the game's own frame, and a leaked `fillStyle`
 *   or `font` would silently restyle the next frame's drawing — a bug that looks
 *   like it lives in the game.
 * - Nothing accumulates. The registry is keyed by the names the game registers,
 *   which are declared once during initialization, and the frame timing and the
 *   renderer's counts are *read* through seams rather than collected here. A run of
 *   any length leaves this module holding exactly as much as a run of one frame
 *   does.
 *
 * Two things separate this overlay from the two-dimensional engine's, and both come
 * from there being a 3D picture underneath it:
 *
 * - **It draws on the screen layer, in device space.** The game's own 2D drawing is
 *   laid out in the logical field the viewport letterboxes into the canvas; the
 *   overlay is chrome over the finished picture, so the engine resets the layer's
 *   transform to the identity before calling {@link Diagnostics.draw} and this
 *   module issues no transform of its own. Debug text therefore stays the same
 *   physical size and stays crisp however far the game's coordinates are scaled,
 *   and — because the layer is composited over the 3D picture at the end of the
 *   frame — the panel sits on top of the scene as well as on top of the HUD.
 * - **The metrics carry the renderer's cost.** A frame time says a build is slow;
 *   the draw calls and triangles say whether the cost is in the scene it submits.
 *   They are read through {@link RendererCounts} rather than off a live renderer,
 *   which keeps this module free of a GPU, of a renderer's construction order, and
 *   of `three` in any form. {@link rendererCounts} is the adapter the engine wires
 *   the render stage in with — the stage, and not the renderer, because a
 *   renderer's own counters are reset at the top of every `render` call and the
 *   engine makes a second one to composite the screen layer. Reading them live
 *   would report the engine's own full-screen quad rather than the game's scene.
 *
 * The counts describe *one* frame rather than the window the timings summarize:
 * they are whatever the renderer reports for the frame it most recently drew. A
 * draw-call total averaged over ten seconds answers no question a reader of a 3D
 * overlay is asking, so nothing here averages them.
 *
 * The backtick key that flips the panel is wired by the engine, on the event target
 * the surface supplies; this module owns only {@link Diagnostics.toggle}, which is
 * what that key calls.
 */

import type {
  DiagnosticReading,
  DiagnosticValue,
  FrameMetrics,
} from "./contract";

/** Where the panel sits, and how much air its contents get, in device pixels. */
const MARGIN = 8;
const PADDING = 6;

/**
 * A monospace stack, so columns of numbers line up and a value changing width does
 * not shuffle the whole line sideways from frame to frame.
 */
const FONT_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Translucent, so the panel reads over whatever the game drew underneath it. */
const PANEL_FILL = "rgba(0, 0, 0, 0.62)";
const TEXT_FILL = "rgba(255, 255, 255, 0.94)";

/** The sparkline's own plot area, and the bars standing in it. */
const GRAPH_BACK_FILL = "rgba(255, 255, 255, 0.12)";
const GRAPH_BAR_FILL = "rgba(127, 209, 255, 0.92)";

/**
 * The shortest frame time the graph will scale to, in milliseconds.
 *
 * Without a floor the vertical scale is the window's own maximum, so a run pinned at
 * a steady 16.7 ms would draw as a full-height wall and a run wobbling between 16.6
 * and 16.8 would draw as dramatic peaks — the graph would amplify noise into
 * something that looks like a problem. Roughly two frames at sixty a second is the
 * point past which unevenness is worth seeing, so that is where the axis starts.
 */
const GRAPH_FLOOR_MS = 33.3;

/** The plot area's size, as multiples of the overlay's own type size. */
const GRAPH_WIDTH_EMS = 8;
const GRAPH_HEIGHT_LINES = 2;

/**
 * The windowed half of {@link FrameMetrics}: everything the frame loop can answer
 * on its own.
 *
 * Derived from the contract type rather than restated, so the two cannot drift: the
 * loop times frames and knows nothing about a renderer, and the renderer counts
 * one frame and knows nothing about a window. {@link Diagnostics.metrics} is where
 * the two halves are put back together into the figure the overlay reports.
 */
export type FrameTimingSummary = Omit<FrameMetrics, "drawCalls" | "triangles">;

/**
 * Where the overlay reads the engine's frame timing.
 *
 * Both halves are pulled, for the same reason a diagnostic source is: the overlay
 * reports what the loop holds at the instant it draws. The series is handed over as
 * a `readonly` view of the loop's own ring rather than copied, because copying it
 * every frame would allocate the window all over again for a picture that is thrown
 * away immediately — and because the overlay has no business keeping it.
 */
export interface FrameTimings {
  /** The summary of the current window. */
  metrics(): FrameTimingSummary;
  /** The window's samples in milliseconds, oldest first, owned by the loop. */
  series(): readonly number[];
}

/**
 * Where the overlay reads the renderer's cost for the frame just drawn.
 *
 * A seam rather than a renderer, because a renderer is a GPU context this module has
 * no other use for, and because the two figures are the only thing the overlay wants
 * from one. Both are pulled on each read, so what the panel shows is the frame the
 * picture underneath it came from.
 */
export interface RendererCounts {
  /** Draw calls issued for the frame the renderer most recently drew. */
  drawCalls(): number;
  /** Triangles drawn in that frame. */
  triangles(): number;
}

/**
 * What the overlay reads before a loop has been attached.
 *
 * An engine is constructed before it has run anything, and a `Diagnostics` may be
 * built, read and drawn in that state (a test, or a build whose overlay is switched
 * on before the first frame). An empty window is the honest answer, and it keeps
 * every caller free of a "no loop yet" branch.
 */
const IDLE_TIMINGS: FrameTimings = {
  metrics: () => ({ samples: 0, meanMs: 0, p95Ms: 0, p99Ms: 0 }),
  series: () => [],
};

/**
 * What the overlay reads before a renderer has drawn anything.
 *
 * Zero is what the contract promises before the first render, and it is also what a
 * real renderer reports at that point, so the idle seam and a freshly constructed
 * renderer agree rather than the overlay having to tell them apart.
 */
const IDLE_COUNTS: RendererCounts = {
  drawCalls: () => 0,
  triangles: () => 0,
};

/**
 * The render stage, narrowed to the one member that carries the figures.
 *
 * Written structurally rather than imported from the rendering module, because the
 * point of {@link RendererCounts} is that the overlay knows nothing about how the
 * picture underneath it is produced. The rendering module's own return type
 * satisfies this shape, so the engine's wiring is a plain call and a rename on
 * either side fails at that call rather than silently here.
 */
interface SceneCounts {
  /** The scene render's draw counts for the frame most recently drawn. */
  counts(): { readonly drawCalls: number; readonly triangles: number };
}

/**
 * The render stage's counts for the scene it last drew, as the overlay reads them.
 *
 * Deliberately *not* `renderer.info.render`. Three resets those counters at the top
 * of every `render` call, and the engine makes two per frame — the scene, then the
 * full-screen quad that composites the screen layer over it — so a panel reading
 * them live would report one draw call and two triangles for every frame however
 * much the game submitted. The stage captures them the instant the scene is drawn
 * and hands that snapshot out through `counts()`, which is the figure
 * `apis/diagnostics.md` describes: the renderer's counts "for the frame most
 * recently rendered", read after the scene was drawn.
 *
 * Still pulled on every call rather than captured here, so a panel drawn over frame
 * two hundred reports frame two hundred. The parameter is narrowed to the one member
 * that carries the figures, which is what lets a test hand in a plain object.
 */
export function rendererCounts(stage: SceneCounts): RendererCounts {
  return {
    drawCalls: () => stage.counts().drawCalls,
    triangles: () => stage.counts().triangles,
  };
}

/**
 * Render one source's value as a single overlay line.
 *
 * Non-integer numbers are fixed to three decimals because a raw float is typically
 * seventeen characters of noise the reader has to re-parse every frame. Every other
 * value the union admits reads as itself.
 */
function formatValue(value: DiagnosticValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  return String(value);
}

/**
 * One reading as the panel's value column: the value formatted, or the message of the
 * source that failed to produce one.
 *
 * The empty string is unreachable — a reading carries exactly one of the two — and it
 * stands here because that invariant lives in the type's documentation rather than in
 * a shape the compiler can narrow.
 */
function readingText(reading: DiagnosticReading): string {
  return reading.value === undefined
    ? (reading.error ?? "")
    : formatValue(reading.value);
}

/**
 * A frame time, at the precision a reader can act on.
 *
 * One decimal separates 16.7 ms from 20.0 ms — the difference between hitting sixty
 * frames a second and missing it — while a second decimal would only jitter under
 * the eye of anyone watching the figure change every frame.
 */
function formatMs(ms: number): string {
  return ms.toFixed(1);
}

/**
 * The engine's own line: the three figures that say whether frames are even, and
 * the two that say what the renderer spent drawing the last of them.
 */
function metricsLine(metrics: FrameMetrics): string {
  const mean = formatMs(metrics.meanMs);
  const tail = `${formatMs(metrics.p95Ms)} / ${formatMs(metrics.p99Ms)}`;
  const cost = `${metrics.drawCalls} draws · ${metrics.triangles} tris`;
  return `frame: ${mean} / ${tail} ms · ${cost}`;
}

/** The message to show for a source that threw, from whatever it threw. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The tallest sample the graph has to fit, never below the floor. */
function graphCeiling(series: readonly number[]): number {
  let ceiling = GRAPH_FLOOR_MS;
  for (const sample of series) {
    if (Number.isFinite(sample) && sample > ceiling) ceiling = sample;
  }
  return ceiling;
}

/**
 * The registry behind the engine's `diagnostics` facade and its overlay toggle key.
 */
export class Diagnostics {
  /**
   * Insertion-ordered, and re-registering a name deliberately keeps the original
   * position (a `Map` set on an existing key does not move it): a value the game
   * re-registers mid-run should not make every line below it jump.
   */
  private readonly sources = new Map<string, () => DiagnosticValue>();

  private on = false;

  /**
   * The frame loop's timing, assignable so the engine can wire the two together in
   * whichever order it builds them. It is a plain field rather than a constructor
   * requirement because a `Diagnostics` is perfectly meaningful without a loop — it
   * simply reports an empty window until one is attached.
   */
  timings: FrameTimings;

  /**
   * The renderer's counters, assignable for the same reason and with the same
   * consequence: an overlay built before the renderer reports zeroes, which is what
   * a renderer that has drawn nothing reports too.
   */
  counts: RendererCounts;

  constructor(
    timings: FrameTimings = IDLE_TIMINGS,
    counts: RendererCounts = IDLE_COUNTS,
  ) {
    this.timings = timings;
    this.counts = counts;
  }

  /**
   * Name a value for the overlay. The source is called on every read, not sampled
   * at registration, so it always reports the live state.
   */
  register(name: string, source: () => DiagnosticValue): void {
    this.sources.set(name, source);
  }

  /** Show or hide the overlay. */
  setEnabled(enabled: boolean): void {
    this.on = enabled;
  }

  /** Whether the overlay is currently drawn. */
  enabled(): boolean {
    return this.on;
  }

  /** Flip the overlay — what the engine's toggle key is wired to. */
  toggle(): void {
    this.on = !this.on;
  }

  /**
   * Evaluate every source, in registration order, one reading each.
   *
   * A sequence rather than a record, because registration order is what the panel
   * draws in and what a check asserting the panel's column reads. A source that
   * throws yields a reading carrying its message and no value, so this never throws,
   * and it is independent of {@link Diagnostics.enabled} — a hidden overlay reads
   * exactly as a visible one does.
   *
   * {@link Diagnostics.draw} calls this once per drawn frame and formats the result
   * into the panel's lines, so what the panel shows is the simulation's live state.
   */
  read(): readonly DiagnosticReading[] {
    const readings: DiagnosticReading[] = [];
    for (const [name, source] of this.sources) {
      try {
        readings.push({ name, value: source() });
      } catch (error) {
        readings.push({ name, error: failureText(error) });
      }
    }
    return readings;
  }

  /**
   * The window's frame timing beside the renderer's counts for the last frame.
   *
   * Both are read through their seams rather than collected here, and the figure is
   * assembled field by field rather than by spreading what the loop returned: a loop
   * that hands back a whole {@link FrameMetrics} must not be able to slip a stale
   * `drawCalls` past the renderer, which is the only authority on that number.
   *
   * {@link Diagnostics.draw} puts the result under the game's own lines, beside the
   * sparkline, so what a frame cost sits next to what the frame produced.
   */
  metrics(): FrameMetrics {
    const timing = this.timings.metrics();
    return {
      samples: timing.samples,
      meanMs: timing.meanMs,
      p95Ms: timing.p95Ms,
      p99Ms: timing.p99Ms,
      drawCalls: this.counts.drawCalls(),
      triangles: this.counts.triangles(),
    };
  }

  /**
   * Draw the panel top-left, sized to its own contents and clamped to the
   * `width`/`height` of the surface it is drawn on.
   *
   * Those are *device* pixels, not logical ones: `ctx` is the screen layer's
   * context and the engine resets its transform to the identity before calling
   * this, so the overlay is chrome measured in the canvas's backing store rather
   * than in the letterboxed coordinates the game's own 2D drawing uses. Nothing
   * here sets a transform, which is what keeps that true — debug text stays the
   * same physical size and stays crisp however far the game's coordinates are being
   * scaled, and follows the device pixel ratio for free.
   *
   * The registered lines come first, then the frame figures and the renderer's
   * counts, with the sparkline standing beside them — the game's own vocabulary
   * keeps the reading order it was registered in, and the engine's numbers sit
   * under it rather than pushing it down the panel.
   *
   * Nothing is drawn when the overlay is off, and nothing is drawn when there is
   * nothing to say — no registered sources and no frames timed yet. An empty panel
   * is chrome that hides the game for no information.
   */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.on) return;

    const metrics = this.metrics();
    const lines = this.read().map(
      (reading) => `${reading.name}: ${readingText(reading)}`,
    );
    if (metrics.samples > 0) lines.push(metricsLine(metrics));
    if (lines.length === 0) return;

    // The series is only *read* here, never held: whatever the loop hands back is
    // plotted this frame and forgotten.
    const series = metrics.samples > 0 ? this.timings.series() : [];

    // Scale with the surface height so the overlay stays readable on a tall canvas
    // without swallowing a short one, with a floor for legibility. Because the
    // height is in device pixels, this tracks the device pixel ratio for free.
    const fontSize = Math.max(11, Math.round(height * 0.02));
    const lineHeight = Math.round(fontSize * 1.4);
    const graphWidth =
      series.length > 0 ? Math.round(fontSize * GRAPH_WIDTH_EMS) : 0;
    const graphHeight = series.length > 0 ? lineHeight * GRAPH_HEIGHT_LINES : 0;

    ctx.save();
    try {
      ctx.font = `${fontSize}px ${FONT_STACK}`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      let textWidth = 0;
      for (const line of lines)
        textWidth = Math.max(textWidth, ctx.measureText(line).width);

      const contentWidth =
        textWidth + (graphWidth > 0 ? PADDING + graphWidth : 0);
      const contentHeight = Math.max(lines.length * lineHeight, graphHeight);
      const panelWidth = Math.min(
        contentWidth + PADDING * 2,
        Math.max(width - MARGIN * 2, 0),
      );
      const panelHeight = Math.min(
        contentHeight + PADDING * 2,
        Math.max(height - MARGIN * 2, 0),
      );

      ctx.fillStyle = PANEL_FILL;
      ctx.fillRect(MARGIN, MARGIN, panelWidth, panelHeight);

      const left = MARGIN + PADDING;
      const top = MARGIN + PADDING;

      ctx.fillStyle = TEXT_FILL;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i] ?? "", left, top + i * lineHeight);
      }

      if (graphWidth > 0) {
        this.drawGraph(
          ctx,
          series,
          left + textWidth + PADDING,
          top,
          graphWidth,
          graphHeight,
        );
      }
    } finally {
      // `finally`, not a trailing call: if measuring or drawing throws (a fake or a
      // lost context), the game's style must still come back.
      ctx.restore();
    }
  }

  /**
   * Plot the window as a sparkline, oldest sample at the left and newest at the
   * right, so the picture reads in the direction time ran.
   *
   * The plot area is a fixed size and the window is not, so a column is the area's
   * width divided by the sample count rather than a fixed number of pixels: a short
   * window draws as wide bars, a full one as a dense band, and either way the whole
   * window is visible without the graph growing across the panel. Columns narrower
   * than a pixel are still drawn a pixel wide, which lets the spikes that matter
   * survive at any window length.
   */
  private drawGraph(
    ctx: CanvasRenderingContext2D,
    series: readonly number[],
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    ctx.fillStyle = GRAPH_BACK_FILL;
    ctx.fillRect(x, y, width, height);

    const ceiling = graphCeiling(series);
    const columnWidth = width / series.length;

    ctx.fillStyle = GRAPH_BAR_FILL;
    for (let i = 0; i < series.length; i++) {
      const sample = series[i] ?? 0;
      // A sample above the ceiling cannot happen (the ceiling is the maximum), but
      // clamping keeps a non-finite one from drawing a bar of `NaN` height.
      const fraction = Number.isFinite(sample)
        ? Math.min(Math.max(sample, 0) / ceiling, 1)
        : 0;
      const barHeight = fraction * height;
      const barWidth = Math.max(columnWidth, 1);
      ctx.fillRect(
        x + i * columnWidth,
        y + height - barHeight,
        barWidth,
        barHeight,
      );
    }
  }
}
