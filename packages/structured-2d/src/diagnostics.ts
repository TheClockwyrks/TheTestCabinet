/**
 * Diagnostics: the debug overlay and the frame metrics beneath it.
 *
 * The overlay draws three things: the engine's own line for the open world
 * (`level: … phase: … actors: …`), the named values a game registers, and the
 * frame-time metrics line with its graph. A game registers sources into one of
 * two registries — the instance registry (through `InitApi.diagnostics`, alive
 * for the engine's life) and the world registry (through `world.diagnostics`,
 * dropped when the world closes) — and the engine owns everything around them.
 *
 * A source is a zero-argument function invoked on each read, never sampled at
 * registration. `read()` evaluates every source in both registries — instance
 * first, then world, each in registration order — and never throws: a source
 * that throws contributes its error message as a string. Re-registering a name
 * replaces its source and retains the name's original position.
 *
 * The metrics window is the last 10 seconds of frames measured against
 * simulated time, in a ring buffer capped at 2048 samples; percentiles are
 * nearest-rank. The overlay is hidden when the engine is created, and the
 * engine toggles it on an unrepeated `Backquote` keydown — engine chrome
 * rather than a registered action, so the action registry stays the game's
 * own.
 *
 * Three rules follow from the overlay being *read-only* chrome, and all three
 * are enforced here rather than left to the game's good behaviour: a throwing
 * source yields its message and the rest of the panel draws normally,
 * {@link Diagnostics.draw} saves and restores the 2D context around everything
 * it does (a leaked `fillStyle` would silently restyle the next frame's
 * drawing), and nothing here grows with the length of a run — the registries
 * are bounded by the names the game registers and the metrics by the ring.
 */

import type { FrameMetrics } from "./contract";

/**
 * How long the metrics window reaches back, in *simulated* milliseconds.
 *
 * Simulated rather than wall time because that is the only clock both entry
 * points share: under `advance` no real time passes at all, and a wall-clock
 * window would report an entire scripted run as one instant.
 */
const SAMPLE_WINDOW_MS = 10_000;

/**
 * The most samples the window holds. The age rule alone is not a bound: a
 * build delivering frames faster than about 204 a second would otherwise grow
 * the buffer, so past the cap the window simply summarizes a shorter span of
 * history — the most recent 2048 frames.
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
 * wobbling between 16.6 and 16.8 would draw as dramatic peaks — the graph
 * would amplify noise into something that looks like a problem. An even run
 * reads as flat instead.
 */
const GRAPH_FLOOR_MS = 33.3;

/** The plot area's size, as multiples of the overlay's own type size. */
const GRAPH_WIDTH_EMS = 8;
const GRAPH_HEIGHT_LINES = 2;

/**
 * The engine's own line for the open world, as {@link Diagnostics.draw} reads
 * it: the level name, the match phase, and the number of live actors.
 */
export interface WorldStatus {
  level: string;
  phase: string;
  actors: number;
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
}

/**
 * Render one source's value as a single overlay line.
 *
 * Non-integer numbers are fixed to three decimals because a raw float is
 * seventeen characters of noise the reader has to re-parse every frame;
 * objects go through `JSON.stringify` so a vector or a small state bag is
 * legible without the game pre-formatting it. The `stringify` is guarded: a
 * cyclic value is a perfectly ordinary thing to hand a debug view, and it must
 * not throw — and a bare `undefined` (which `stringify` yields nothing for)
 * falls back to its `String` form.
 */
function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
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
 * Both rules are load-bearing and neither subsumes the other. Age is what
 * makes the reported figures mean "recently", so a stall the player felt a
 * minute ago stops colouring the percentiles. Capacity is what makes the
 * memory a constant, whatever the frame rate.
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
   * frame, and allocating a two-thousand-element array sixty times a second
   * for a picture that is thrown away immediately is a cost with nothing on
   * the other side of it.
   */
  series(): readonly number[] {
    this.plot.length = this.size;
    for (let i = 0; i < this.size; i++) {
      this.plot[i] = at(this.costMs, (this.oldest + i) % SAMPLE_CAPACITY);
    }
    return this.plot;
  }

  /** The mean and the two percentiles over the live window. */
  metrics(): FrameMetrics {
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
   * Nearest rank rather than interpolation because every figure it reports is
   * a frame time that actually happened, which is what a reader comparing the
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
  private readonly instanceSources = new Map<string, () => unknown>();
  private readonly worldSources = new Map<string, () => unknown>();
  private readonly window = new SampleWindow();
  private readonly world: () => WorldStatus | null;
  private on = false;

  constructor(options: DiagnosticsOptions = {}) {
    this.world = options.world ?? ((): WorldStatus | null => null);
  }

  /**
   * Registers `source` under `name` in the instance registry, which lives as
   * long as the engine and survives every level transition. The source is
   * called on every read, not sampled at registration, so it always reports
   * the live state.
   */
  registerInstance(name: string, source: () => unknown): void {
    this.instanceSources.set(name, source);
  }

  /**
   * Registers `source` under `name` in the world registry, which lives as
   * long as the world.
   */
  registerWorld(name: string, source: () => unknown): void {
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
   * Evaluates every source in both registries and returns the values,
   * instance registry first, each in registration order, unformatted. A
   * source that throws contributes its error message as a string; `read`
   * itself never throws, and it is independent of `enabled()`, so a hidden
   * overlay is still readable.
   */
  read(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const registry of [this.instanceSources, this.worldSources]) {
      for (const [name, source] of registry) {
        try {
          values[name] = source();
        } catch (error) {
          values[name] = failureText(error);
        }
      }
    }
    return values;
  }

  /**
   * Records the wall time one frame's work took — its ticks, its collision
   * pass, its render, and the overlay itself — stamped with the frame loop's
   * accumulated simulated time. The engine calls this once per frame that
   * ran; how the timings arrive is this seam, so the metrics need no
   * collaborator wired in later.
   */
  recordFrame(atMs: number, costMs: number): void {
    this.window.record(atMs, costMs);
  }

  /** The frame-time metrics over the current window. */
  metrics(): FrameMetrics {
    return this.window.metrics();
  }

  /**
   * Draws the overlay onto `ctx`, in device pixels — the engine resets the
   * transform to the identity first, so the panel is chrome measured in the
   * canvas's backing store rather than in the game's letterboxed coordinates,
   * which keeps debug text the same physical size and crisp however far the
   * camera is scaling the world.
   *
   * The text is a column of lines, in order: the engine's own world line, the
   * instance registry's lines, the world registry's lines, and the metrics
   * line, with the frame-time graph beside the text to its right. Performs no
   * drawing when the overlay is hidden.
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
    for (const [name, value] of Object.entries(this.read())) {
      lines.push(`${name}: ${formatValue(value)}`);
    }
    const metrics = this.metrics();
    lines.push(
      `frame: ${formatValue(metrics.meanMs)} / ${formatValue(metrics.p95Ms)} / ${formatValue(metrics.p99Ms)} ms`,
    );

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
      // `finally`, not a trailing call: if measuring or drawing throws (a
      // fake, or a lost context), the game's style must still come back.
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
   * either way the whole window is visible without the graph growing across
   * the panel. Columns narrower than a pixel are still drawn a pixel wide,
   * which lets the spikes that matter survive at any window length.
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
      // but clamping keeps a non-finite one from drawing a bar of `NaN`
      // height.
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
