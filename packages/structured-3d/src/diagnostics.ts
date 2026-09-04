/**
 * Diagnostics: the two registries, the debug overlay, and the frame metrics
 * beneath it.
 *
 * The overlay draws three things: the engine's own line for the open world
 * (`level: … phase: … actors: …`), the named values a game registers, and the
 * metrics line carrying the frame times beside the renderer's counts, with the
 * frame-time graph standing to the right of the text. The engine cannot know
 * what is worth watching inside someone else's simulation, so it does not
 * guess: a game registers named sources and the engine owns everything around
 * them — the panel, the toggle key, the world line, and the metrics.
 *
 * A source is a zero-argument function invoked on each read, never sampled at
 * registration, so it reports whatever the game holds at that instant and stays
 * in step with the state it closes over. {@link Diagnostics.read} evaluates
 * every source in both registries, the instance's first and then the world's,
 * each in registration order, returns one reading each, and never throws.
 * Re-registering a name replaces its source and retains the name's original
 * position, so redefining one value mid-run leaves every line below it in
 * place.
 *
 * **Two registries, because the framework has two lifetimes.** The instance
 * registry lives as long as the engine and its sources survive every level
 * transition; the world registry lives as long as the world, and
 * {@link Diagnostics.dropWorldSources} empties it when the world closes, along
 * with the world's timers. A name registered in both keeps a line in each,
 * which is why a reading is a sequence entry rather than a record key.
 *
 * Three rules follow from the overlay being *read-only* chrome, and all three
 * are enforced here rather than left to the game's good behaviour:
 *
 * - **A source that throws is contained.** A diagnostic exists to explain a
 *   failure, so it must never be the cause of one — a throwing source yields a
 *   reading carrying its message and no value, the panel draws that message in
 *   the value's place, and the remaining lines draw normally. A failure stays
 *   distinguishable from every value a working source could report, rather than
 *   arriving as a string a check might accept as a legitimate reading.
 * - **{@link Diagnostics.draw} saves and restores the context** around
 *   everything it does, in a `finally` rather than a trailing call: the overlay
 *   draws after the game's own frame, and a leaked `fillStyle` or `font` would
 *   silently restyle the next frame's drawing — a bug that looks like it lives
 *   in the game.
 * - **Nothing accumulates.** The registries are bounded by the names the game
 *   registers, which are declared once when the instance initializes and once
 *   per world, and the window is a ring of a fixed capacity. A run of any
 *   length leaves this module holding exactly as much as a run of one frame
 *   does.
 *
 * Two things separate this overlay from the two-dimensional framework's, and
 * both come from there being a 3D picture underneath it:
 *
 * - **It draws on the screen layer, in device space.** The game's own
 *   screen-space drawing is laid out in the logical field the viewport
 *   letterboxes into the canvas; the overlay is chrome over the finished
 *   picture, so the engine resets the layer's transform to the identity before
 *   calling {@link Diagnostics.draw} and this module issues no transform of its
 *   own. Debug text therefore stays the same physical size and stays crisp
 *   whatever the camera is doing to the world, type size tracks the surface
 *   height so it follows the device pixel ratio for free, and — because the
 *   screen layer is composited over the 3D picture at the end of the frame —
 *   the panel sits over the world and over every screen-space component alike.
 * - **The metrics carry the renderer's cost.** A frame time says a build is
 *   slow; the draw calls and the triangles say whether the cost is in the scene
 *   it submits, since a few draws that each take long is a different problem
 *   from thousands that each take nothing. They are read through
 *   {@link RendererCounts} rather than off a live renderer, which keeps this
 *   module free of a GPU, of a renderer's construction order, and of `three` in
 *   any form. {@link rendererCounts} is the adapter the engine wires the render
 *   stage in with — the *stage*, and not the renderer, because a renderer's own
 *   counters are reset at the top of every `render` call and the engine makes a
 *   second one to composite the screen layer over the scene. Reading them live
 *   would report the engine's own full-screen quad rather than the game's
 *   scene.
 *
 * The two counts describe *one* frame rather than the window the timings
 * summarize: they are whatever the renderer reported for the frame it most
 * recently drew, and both are `0` before the first render. A draw-call total
 * averaged over ten seconds answers no question a reader of a 3D overlay is
 * asking, so nothing here averages them.
 *
 * The window itself lives here rather than behind a seam, because the frame
 * loop has nothing to do with it beyond handing over what a frame cost:
 * {@link Diagnostics.recordFrame} takes the wall time spent in a frame's ticks,
 * its collision pass, its render, and the overlay itself, stamped with the
 * loop's accumulated *simulated* time.
 *
 * The backtick key that flips the panel is wired by the engine, on the event
 * target the surface supplies; this module owns only
 * {@link Diagnostics.toggle}, which is what that key calls.
 */

import type {
  DiagnosticReading,
  DiagnosticValue,
  FrameMetrics,
} from "./contract";

/**
 * How long the metrics window reaches back, in *simulated* milliseconds.
 *
 * Simulated rather than wall time because that is the only clock both entry
 * points share: under a stepped run no real time passes at all, and a
 * wall-clock window would report an entire scripted run as one instant.
 */
const SAMPLE_WINDOW_MS = 10_000;

/**
 * The most samples the window holds. The age rule alone is not a bound: a build
 * delivering frames faster than about 204 a second would otherwise grow the
 * buffer, so past the cap the window simply summarizes a shorter span of
 * history — the most recent 2048 frames — in place of growing.
 */
const SAMPLE_CAPACITY = 2048;

/** Where the panel sits, and how much air its contents get, in device pixels. */
const MARGIN = 8;
const PADDING = 6;

/**
 * A monospace stack, so columns of numbers line up and a value changing width
 * does not shuffle the whole line sideways from frame to frame.
 */
const FONT_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Translucent, so the panel reads over whatever the game drew underneath it. */
const PANEL_FILL = "rgba(0, 0, 0, 0.62)";
const TEXT_FILL = "rgba(255, 255, 255, 0.94)";

/** The graph's own plot area, and the columns standing in it. */
const GRAPH_BACK_FILL = "rgba(255, 255, 255, 0.12)";
const GRAPH_BAR_FILL = "rgba(127, 209, 255, 0.92)";

/**
 * The shortest frame time the graph will scale to, in milliseconds.
 *
 * Without a floor the vertical scale is the window's own maximum, so a run
 * pinned at a steady 16.7 ms would draw as a full-height wall and a run
 * wobbling between 16.6 and 16.8 would draw as dramatic peaks — the graph would
 * amplify noise into something that looks like a problem. An even run reads as
 * flat instead.
 */
const GRAPH_FLOOR_MS = 33.3;

/** The plot area's size, as multiples of the overlay's own type size. */
const GRAPH_WIDTH_EMS = 8;
const GRAPH_HEIGHT_LINES = 2;

/**
 * The engine's own line for the open world, as {@link Diagnostics.draw} reads
 * it: the open level's name, the match phase, and the number of live actors.
 *
 * Those three answer where a build is before any of the game's own values are
 * read, and the engine holds all three already, so no build has to register
 * them.
 */
export interface WorldStatus {
  /** The open level's name. */
  level: string;
  /** The match phase, as the game mode reports it. */
  phase: string;
  /** How many actors are live in the open world. */
  actors: number;
}

/**
 * The windowed half of {@link FrameMetrics}: everything the frame timings can
 * answer on their own.
 *
 * Derived from the contract type rather than restated, so the two cannot drift.
 * The window times frames and knows nothing about a renderer; the renderer
 * counts one frame and knows nothing about a window. {@link Diagnostics.metrics}
 * is where the two halves are put back together into the figure the overlay
 * reports.
 */
export type FrameTimingSummary = Omit<FrameMetrics, "drawCalls" | "triangles">;

/**
 * Where the overlay reads the renderer's cost for the frame just drawn.
 *
 * A seam rather than a renderer, because a renderer is a GPU context this
 * module has no other use for, and because the two figures are the only thing
 * the overlay wants from one. Both are pulled on each read, for the same reason
 * a diagnostic source is: what the panel shows is the frame the picture
 * underneath it came from.
 */
export interface RendererCounts {
  /** Draw calls issued for the frame the renderer most recently drew. */
  drawCalls(): number;
  /** Triangles drawn in that frame. */
  triangles(): number;
}

/**
 * What the overlay reads before a renderer has drawn anything.
 *
 * Zero is what the contract promises before the first render, and it is also
 * what a real renderer reports at that point, so the idle seam and a freshly
 * constructed renderer agree rather than the overlay having to tell them apart.
 */
const IDLE_COUNTS: RendererCounts = {
  drawCalls: () => 0,
  triangles: () => 0,
};

/**
 * The render stage, narrowed to the one member that carries the figures.
 *
 * Written structurally rather than imported from the rendering module, because
 * the point of {@link RendererCounts} is that the overlay knows nothing about
 * how the picture underneath it is produced. The pipeline's own return type
 * satisfies this shape, so the engine's wiring is a plain call and a rename on
 * either side fails at that call rather than silently here.
 */
interface SceneCounts {
  /** The scene render's draw counts for the frame most recently drawn. */
  counts(): { readonly drawCalls: number; readonly triangles: number };
}

/** What a {@link Diagnostics} is built over. Every field has a working default. */
export interface DiagnosticsOptions {
  /**
   * Where the overlay reads the open world's line, or `null` while no world is
   * open (construction, a transition's gap); defaults to never having one. A
   * provider rather than a value, for the same reason a source is: the line
   * reports what the engine holds at the instant the overlay draws.
   */
  world?: () => WorldStatus | null;
  /**
   * Where the metrics read the renderer's counts for the last frame; defaults
   * to a renderer that has drawn nothing.
   */
  counts?: RendererCounts;
}

/**
 * The render stage's counts for the scene it last drew, as the overlay reads
 * them.
 *
 * Deliberately *not* `renderer.info.render`. Three resets those counters at the
 * top of every `render` call, and the engine makes two per frame — the scene,
 * then the full-screen quad that composites the screen layer over it — so a
 * panel reading them live would report one draw call and two triangles for
 * every frame however much the game submitted. The stage captures them the
 * instant the scene is drawn and hands that snapshot out through `counts()`,
 * which is the figure the diagnostics API describes: the renderer's counts for
 * the frame most recently rendered, read after the scene has been rendered.
 *
 * Still pulled on every call rather than captured here, so a panel drawn over
 * frame two hundred reports frame two hundred. The parameter is narrowed to the
 * one member that carries the figures, which is what lets a test hand in a
 * plain object.
 */
export function rendererCounts(stage: SceneCounts): RendererCounts {
  return {
    drawCalls: () => stage.counts().drawCalls,
    triangles: () => stage.counts().triangles,
  };
}

/**
 * Render one number as the panel shows it.
 *
 * Non-integer numbers are fixed to three decimals because a raw float is
 * typically seventeen characters of noise the reader has to re-parse every
 * frame. The engine owns this so that every build's overlay reads the same way.
 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

/**
 * Render one source's value as a single overlay line.
 *
 * A string reads as itself, a boolean as `"true"` or `"false"`, and a number
 * through {@link formatNumber} — which leaves a non-finite one as `NaN`,
 * `Infinity`, or `-Infinity`, since none of the three is an integer and
 * `toFixed` reports each as its own name.
 */
function formatValue(value: DiagnosticValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}

/**
 * One reading as the panel's value column: the value formatted, or the message
 * of the source that failed to produce one.
 *
 * The empty string is unreachable — a reading carries exactly one of the two —
 * and stands here because that invariant lives in the type's documentation
 * rather than in a shape the compiler can narrow.
 */
function readingText(reading: DiagnosticReading): string {
  return reading.value === undefined
    ? (reading.error ?? "")
    : formatValue(reading.value);
}

/** The message to show for a source that threw, from whatever it threw. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The engine's own line: the three figures that say whether frames are even,
 * and the two that say what the renderer spent drawing the last of them.
 *
 * The counts sit after the timings rather than on a line of their own because a
 * slow frame is read *against* how much was submitted, and two figures a reader
 * has to scan between are two figures they will not compare.
 */
function metricsLine(metrics: FrameMetrics): string {
  const times = `${formatNumber(metrics.meanMs)} / ${formatNumber(metrics.p95Ms)} / ${formatNumber(metrics.p99Ms)}`;
  const cost = `${metrics.drawCalls} draws · ${metrics.triangles} tris`;
  return `frame: ${times} ms · ${cost}`;
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
 * A typed-array read, as a number. `noUncheckedIndexedAccess` widens every
 * indexed read to `| undefined`, which is the right default for a `Record` and
 * pure noise for a fixed-length buffer whose indices are computed modulo its
 * own capacity.
 */
function at(buffer: Float64Array, index: number): number {
  return buffer[index] ?? 0;
}

/**
 * The frame-time window: a ring of samples, evicted by age *and* by capacity.
 *
 * Both rules are load-bearing and neither subsumes the other. Age is what makes
 * the reported figures mean "recently", so a stall the player felt a minute ago
 * stops colouring the percentiles once the game has recovered. Capacity is what
 * makes the memory a constant, whatever the frame rate.
 */
class SampleWindow {
  /** Milliseconds each frame took, indexed by ring position. */
  private readonly costMs = new Float64Array(SAMPLE_CAPACITY);
  /** The simulated time each frame was recorded at, indexed by ring position. */
  private readonly atMs = new Float64Array(SAMPLE_CAPACITY);
  /** The unrolled, oldest-first view {@link SampleWindow.series} refills and returns. */
  private readonly plot: number[] = [];
  /** Ring position of the oldest live sample. */
  private oldest = 0;
  /** How many of the ring's slots are live. */
  private size = 0;

  /** Record one frame, then drop whatever that pushed out of the window. */
  record(atMs: number, costMs: number): void {
    const slot = (this.oldest + this.size) % SAMPLE_CAPACITY;
    this.costMs[slot] = costMs;
    this.atMs[slot] = atMs;

    if (this.size === SAMPLE_CAPACITY) {
      // Full: the write above landed on the oldest sample, so the ring has
      // already forgotten it and only the start marker needs to follow.
      this.oldest = (this.oldest + 1) % SAMPLE_CAPACITY;
    } else {
      this.size += 1;
    }

    while (
      this.size > 0 &&
      atMs - at(this.atMs, this.oldest) > SAMPLE_WINDOW_MS
    ) {
      this.oldest = (this.oldest + 1) % SAMPLE_CAPACITY;
      this.size -= 1;
    }
  }

  /**
   * The live samples in milliseconds, oldest first, as a `readonly` view of a
   * buffer the window owns and refills: this is read once per drawn overlay
   * frame, and allocating a two-thousand-element array sixty times a second for
   * a picture that is thrown away immediately is a cost with nothing on the
   * other side of it.
   */
  series(): readonly number[] {
    this.plot.length = this.size;
    for (let i = 0; i < this.size; i++) {
      this.plot[i] = at(this.costMs, (this.oldest + i) % SAMPLE_CAPACITY);
    }
    return this.plot;
  }

  /** The mean and the two percentiles over the live window. */
  metrics(): FrameTimingSummary {
    if (this.size === 0) return { samples: 0, meanMs: 0, p95Ms: 0, p99Ms: 0 };

    const sorted = new Float64Array(this.size);
    let total = 0;
    for (let i = 0; i < this.size; i++) {
      const cost = at(this.costMs, (this.oldest + i) % SAMPLE_CAPACITY);
      sorted[i] = cost;
      total += cost;
    }
    sorted.sort();

    return {
      samples: this.size,
      meanMs: total / this.size,
      p95Ms: this.percentile(sorted, 0.95),
      p99Ms: this.percentile(sorted, 0.99),
    };
  }

  /**
   * Nearest-rank over the ascending samples: the value at `ceil(p * n) - 1`.
   * Nearest rank rather than interpolation because every figure it reports is a
   * frame time that actually happened, which is what a reader comparing the
   * overlay against a frame they *felt* needs it to be.
   */
  private percentile(sorted: Float64Array, p: number): number {
    const rank = Math.ceil(p * sorted.length) - 1;
    return at(sorted, Math.min(Math.max(rank, 0), sorted.length - 1));
  }
}

/**
 * The engine's diagnostics: both registries, the overlay, and the metrics.
 *
 * Internal: the engine alone constructs it, once. The instance registry lives
 * as long as this object does; the world registry is emptied through
 * {@link Diagnostics.dropWorldSources} on each level transition.
 */
export class Diagnostics {
  /**
   * Insertion-ordered, and re-registering a name deliberately keeps the
   * original position (a `Map` set on an existing key does not move it): a
   * value the game re-registers mid-run should not make every line below it
   * jump.
   */
  private readonly instanceSources = new Map<string, () => DiagnosticValue>();
  private readonly worldSources = new Map<string, () => DiagnosticValue>();
  private readonly window = new SampleWindow();
  private readonly world: () => WorldStatus | null;
  private on = false;

  /**
   * The renderer's counters, assignable so the engine can wire the two together
   * in whichever order it builds them. It is a plain field rather than a
   * constructor requirement because a `Diagnostics` is perfectly meaningful
   * without a pipeline — it simply reports the zeroes a renderer that has drawn
   * nothing reports too, until one is attached.
   */
  counts: RendererCounts;

  constructor(options: DiagnosticsOptions = {}) {
    this.world = options.world ?? ((): WorldStatus | null => null);
    this.counts = options.counts ?? IDLE_COUNTS;
  }

  /**
   * Registers `source` under `name` in the instance registry, which lives as
   * long as the engine and survives every level transition. The source is
   * called on every read, not sampled at registration, so it always reports the
   * live state.
   */
  registerInstance(name: string, source: () => DiagnosticValue): void {
    this.instanceSources.set(name, source);
  }

  /**
   * Registers `source` under `name` in the world registry, which lives as long
   * as the world.
   */
  registerWorld(name: string, source: () => DiagnosticValue): void {
    this.worldSources.set(name, source);
  }

  /** Drops every world-registry source. Called when the world closes. */
  dropWorldSources(): void {
    this.worldSources.clear();
  }

  /** Shows the overlay when `true`, hides it when `false`. */
  setEnabled(enabled: boolean): void {
    this.on = enabled;
  }

  /** Whether the overlay is currently drawn. Hidden at construction. */
  enabled(): boolean {
    return this.on;
  }

  /** Inverts the enabled state. Bound to the `Backquote` key by the engine. */
  toggle(): void {
    this.on = !this.on;
  }

  /**
   * Evaluates every source in both registries and returns one reading each,
   * instance registry first, each in registration order, unformatted.
   *
   * A sequence rather than a record, because that order is what the panel draws
   * in and what a check asserting the panel's column reads, and because a name
   * registered in both registries keeps a reading in each. A source that throws
   * yields a reading carrying its message and no value; `read` itself never
   * throws, and it is independent of {@link Diagnostics.enabled}, so a hidden
   * overlay is still readable.
   */
  read(): readonly DiagnosticReading[] {
    const readings: DiagnosticReading[] = [];
    for (const registry of [this.instanceSources, this.worldSources]) {
      for (const [name, source] of registry) {
        try {
          readings.push({ name, value: source() });
        } catch (error) {
          readings.push({ name, error: failureText(error) });
        }
      }
    }
    return readings;
  }

  /**
   * Records the wall time one frame's work took — its ticks, its collision
   * pass, its render, and the overlay itself — stamped with the frame loop's
   * accumulated simulated time. The engine calls this once per frame that ran.
   */
  recordFrame(atMs: number, costMs: number): void {
    this.window.record(atMs, costMs);
  }

  /**
   * The window's frame timing beside the renderer's counts for the last frame.
   *
   * Assembled field by field rather than by spreading what the window returned:
   * the two halves have different lifetimes — a window of the last ten seconds
   * against the single frame most recently rendered — and the renderer is the
   * only authority on its two counts.
   */
  metrics(): FrameMetrics {
    const timing = this.window.metrics();
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
   * Draws the overlay onto `ctx`, top-left, sized to its own text and clamped
   * to the `width`/`height` of the surface it is drawn on.
   *
   * Those are *device* pixels, not logical ones: `ctx` is the screen layer's
   * context and the engine resets its transform to the identity before calling
   * this, so the overlay is chrome measured in the canvas's backing store
   * rather than in the letterboxed coordinates the game's screen-space drawing
   * uses. Nothing here sets a transform, which is what keeps that true — debug
   * text stays the same physical size and stays crisp whatever the camera is
   * doing to the world, and follows the device pixel ratio for free.
   *
   * The text is a column of lines, in order: the engine's own world line, the
   * instance registry's lines, the world registry's lines, and the metrics
   * line, with the frame-time graph beside the text to its right — so a game's
   * own values keep their place at the top whether or not the window has any
   * samples yet. Performs no drawing when the overlay is hidden.
   */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.on) return;

    const lines: string[] = [];
    const status = this.world();
    if (status !== null) {
      lines.push(
        `level: ${status.level}  phase: ${status.phase}  actors: ${status.actors}`,
      );
    }
    for (const reading of this.read()) {
      lines.push(`${reading.name}: ${readingText(reading)}`);
    }
    const metrics = this.metrics();
    lines.push(metricsLine(metrics));

    // The series is only *read* here, never held: whatever the window hands
    // back is plotted this frame and forgotten. An empty window draws no graph
    // — the text keeps its place at the top either way, since the graph sits
    // beside it rather than above it.
    const series = metrics.samples > 0 ? this.window.series() : [];

    // Scale with the surface height so the overlay stays readable on a tall
    // canvas without swallowing a short one, with a floor for legibility.
    // Because the height is in device pixels, this tracks the device pixel
    // ratio for free.
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
      for (const line of lines) {
        textWidth = Math.max(textWidth, ctx.measureText(line).width);
      }

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
      // `finally`, not a trailing call: if measuring or drawing throws (a fake,
      // or a lost context), the game's style must still come back.
      ctx.restore();
    }
  }

  /**
   * Plots the window's samples oldest at the left and newest at the right, one
   * column per sample, so the picture reads in the direction time ran.
   *
   * The plot area is a fixed size and the window is not, so a column is the
   * area's width divided by the sample count rather than a fixed number of
   * pixels: a short window draws as wide bars, a full one as a dense band, and
   * either way the whole window is visible without the graph growing across the
   * panel. Columns narrower than a pixel are still drawn a pixel wide, which
   * lets the spikes that matter survive at any window length.
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
      // A sample above the ceiling cannot happen (the ceiling is the maximum),
      // but clamping keeps a non-finite one from drawing a bar of `NaN` height.
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
