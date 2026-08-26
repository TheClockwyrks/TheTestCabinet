/**
 * The debug overlay: a read-only window onto values the *game* names, and onto the
 * engine's own frame timing.
 *
 * The engine cannot know what is worth watching in someone else's simulation, so it
 * does not guess: a game registers named sources and the engine owns everything
 * around them — the panel, the toggle key, and the frame metrics. Sources are
 * evaluated on every read rather than sampled at registration, so pressing the
 * toggle shows the state the simulation is in on the frames the panel is drawn over.
 *
 * Two things distinguish this module from its 2D sibling, and both follow from the
 * rendering canvas being a WebGL2 canvas:
 *
 * - The overlay draws on its own 2D surface, composited above the rendering canvas,
 *   because a canvas that yielded a WebGL2 context yields no 2D context. With a
 *   document behind the canvas that surface is a positioned `<canvas>` element; over
 *   a supplied surface with no document it is an `OffscreenCanvas` reached only
 *   through `draw`; and in an environment that can make neither — Node — the overlay
 *   is inert: {@link createOverlaySurface} answers `null`, the engine draws nothing
 *   and calls `draw` on nothing, while `read` and `metrics` answer as always.
 *   Drawing on its own surface is also what keeps the panel out of the evidence:
 *   nothing the overlay does reaches the rendering canvas or the recording.
 * - The frame-time window ({@link SampleWindow}) lives here beside the panel that
 *   reports it, rather than inside the frame loop as the 2D engine keeps it. The
 *   loop records one sample per frame it ran and the overlay reads the summary; the
 *   seam between them is {@link FrameTimings}, which `SampleWindow` satisfies.
 *
 * Three rules follow from "read-only", and all three are enforced here rather than
 * left to the game's good behaviour:
 *
 * - A source that throws is contained. A diagnostic exists to explain a failure, so
 *   it must never be the cause of one — a throwing source yields its error message
 *   as its value and the rest of the panel draws normally.
 * - {@link Diagnostics.draw} saves and restores the 2D context around everything it
 *   does. The overlay draws *after* the game's own frame, and a leaked `fillStyle`
 *   or `font` would silently restyle the next frame's panel.
 * - Nothing accumulates. The registry is keyed by the names the game registers,
 *   which are declared once during initialization, and the frame-time window is a
 *   ring of fixed capacity evicted by age as well as by count. A run of any length
 *   leaves this module holding exactly as much as a run of one frame does.
 */

/* -------------------------------------------------------------------------- */
/* Frame metrics                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The engine's frame-time summary over the current window.
 *
 * Declared here rather than in `contract.ts` because the shared contract module is
 * the recording format's vocabulary, held byte-identical across the 3D packages;
 * `FrameMetrics` is this engine's own diagnostics surface, and the package root
 * re-exports it from here (`apis/diagnostics.md` §Exports).
 */
export interface FrameMetrics {
  /** How many frames the window holds. */
  samples: number;
  /** The arithmetic mean of the window's samples, in milliseconds. */
  meanMs: number;
  /** The 95th percentile of the window's samples, in milliseconds. */
  p95Ms: number;
  /** The 99th percentile of the window's samples, in milliseconds. */
  p99Ms: number;
}

/**
 * How far back the frame-time window reaches, in milliseconds of the frame loop's
 * own simulated time.
 *
 * A duration rather than a frame count, so the figures mean the same thing at
 * every frame rate: a run at 30 frames per second and one at 240 both report the
 * last ten seconds rather than "the last N frames", which would be two different
 * spans of history wearing one label. Simulated rather than wall time, because
 * that is the only clock both entry points share: under `advance` no real time
 * passes at all, and a wall-clock window would report an entire scripted run as
 * one instant.
 */
const SAMPLE_WINDOW_MS = 10_000;

/**
 * The hard ceiling on how many frame-time samples the window holds.
 *
 * The age rule alone is not a bound: a build delivering frames faster than about
 * 204 a second would put more than this many inside ten seconds, and the buffer
 * would grow with the frame rate. The capacity is what makes the memory flat, and
 * the cost of hitting it is only that such a build summarizes a shorter span of
 * history — never that the engine's footprint tracks how long the game has been
 * left running.
 */
const SAMPLE_CAPACITY = 2048;

/**
 * A typed-array read, as a number.
 *
 * `noUncheckedIndexedAccess` widens every indexed read to `| undefined`, which is
 * the right default for a `Record` and pure noise for a fixed-length buffer whose
 * indices are computed modulo its own capacity. Funnelled through one helper so
 * the ring's arithmetic reads as arithmetic.
 */
function at(buffer: Float64Array, index: number): number {
  return buffer[index] ?? 0;
}

/**
 * The frame-time window: a ring of samples, evicted by age *and* by capacity.
 *
 * Both rules are load-bearing and neither subsumes the other. Age is what makes
 * the reported figures mean "recently", so a stall the player felt a minute ago
 * stops colouring the percentiles. Capacity is what makes the memory a constant,
 * so a build running at 500 frames a second for an hour costs exactly what a
 * build running at 30 for a second does.
 *
 * The frame loop owns an instance and records one sample per frame that ran — the
 * wall time spent in `update`, `render`, and the overlay itself — and the shape
 * deliberately satisfies {@link FrameTimings}, so wiring the overlay to the loop
 * is one assignment.
 */
export class SampleWindow {
  /** Milliseconds each frame took, indexed by ring position. */
  private readonly costMs = new Float64Array(SAMPLE_CAPACITY);
  /** The simulated time each frame ended at, indexed by ring position. */
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
      // Full: the write above landed on the oldest sample, so the ring has already
      // forgotten it and only the start marker needs to follow.
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
   * The live samples in milliseconds, oldest first.
   *
   * Handed out as a `readonly` view of a buffer the window owns and refills, rather
   * than as a fresh array: this is read once per drawn overlay frame, and allocating
   * a two-thousand-element array sixty times a second for a picture that is thrown
   * away immediately is a cost with nothing on the other side of it. The reused
   * buffer is bounded by {@link SAMPLE_CAPACITY} like everything else here.
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
   *
   * Nearest rank rather than an interpolated percentile because every figure it
   * reports is a frame time that actually happened, which is what a reader
   * comparing the overlay against a frame they *felt* needs it to be.
   */
  private percentile(sorted: Float64Array, p: number): number {
    const rank = Math.ceil(p * sorted.length) - 1;
    return at(sorted, Math.min(Math.max(rank, 0), sorted.length - 1));
  }
}

/* -------------------------------------------------------------------------- */
/* The overlay panel                                                          */
/* -------------------------------------------------------------------------- */

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
 * Where the overlay reads the engine's frame timing.
 *
 * Both halves are pulled, for the same reason a diagnostic source is: the overlay
 * reports what the loop holds at the instant it draws. The series is handed over as
 * a `readonly` view of the window's own ring rather than copied, because copying it
 * every frame would allocate the window all over again for a picture that is thrown
 * away immediately — and because the overlay has no business keeping it.
 * {@link SampleWindow} satisfies this shape, so the engine wires the two with one
 * assignment.
 */
export interface FrameTimings {
  /** The summary of the current window. */
  metrics(): FrameMetrics;
  /** The window's samples in milliseconds, oldest first, owned by the loop. */
  series(): readonly number[];
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
 * Render one source's value as a single overlay line.
 *
 * Non-integer numbers are fixed to three decimals because a raw float is typically
 * seventeen characters of noise the reader has to re-parse every frame; objects go
 * through `JSON.stringify` so a vector or a small state bag is legible without the
 * game having to pre-format it. The `stringify` is guarded: a cyclic value is a
 * perfectly ordinary thing to hand a debug view, and it must not throw.
 */
function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
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

/** The engine's own line: the three figures that say whether frames are even. */
function metricsLine(metrics: FrameMetrics): string {
  const mean = formatMs(metrics.meanMs);
  const tail = `${formatMs(metrics.p95Ms)} / ${formatMs(metrics.p99Ms)}`;
  return `frame: ${mean} / ${tail} ms`;
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
  private readonly sources = new Map<string, () => unknown>();

  private on = false;

  /**
   * The frame loop's timing, assignable so the engine can wire the two together in
   * whichever order it builds them. It is a plain field rather than a constructor
   * requirement because a `Diagnostics` is perfectly meaningful without a loop — it
   * simply reports an empty window until one is attached.
   */
  timings: FrameTimings;

  constructor(timings: FrameTimings = IDLE_TIMINGS) {
    this.timings = timings;
  }

  /**
   * Name a value for the overlay. The source is called on every read, not sampled
   * at registration, so it always reports the live state. The engine's `InitApi`
   * facade closes each source over its own state feed before it lands here, which
   * is why the registry stores thunks rather than state-taking functions.
   */
  register(name: string, source: () => unknown): void {
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
   * Evaluate every source, yielding a throwing source's error message as its value.
   *
   * {@link Diagnostics.draw} calls this once per drawn frame and formats the result
   * into the panel's lines, so what the panel shows is the simulation's live state.
   * Independent of {@link Diagnostics.enabled}, so a hidden overlay is still
   * readable — and still readable in an environment whose overlay is inert.
   */
  read(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [name, source] of this.sources) {
      try {
        values[name] = source();
      } catch (error) {
        values[name] = failureText(error);
      }
    }
    return values;
  }

  /**
   * The frame timing over the loop's current window.
   *
   * Read from the attached {@link Diagnostics.timings} rather than collected here.
   * {@link Diagnostics.draw} puts it under the game's own lines, beside the
   * sparkline, so the cost of a frame sits next to what the frame produced.
   */
  metrics(): FrameMetrics {
    return this.timings.metrics();
  }

  /**
   * Draw the panel top-left, sized to its own contents and clamped to the
   * `width`/`height` of the surface it is drawn on.
   *
   * Those are *device* pixels of the overlay surface, which tracks the rendering
   * canvas's backing store: the engine resets the transform to the identity before
   * calling this, so the overlay is chrome measured in device pixels rather than in
   * the game's letterboxed logical coordinates. That is what keeps debug text the
   * same physical size and crisp however far the game's world is being scaled, and
   * what lands it clear of the letterbox bars.
   *
   * The context is the *overlay surface's* 2D context, never the rendering
   * canvas's — a WebGL2 canvas has no 2D context to draw on — so nothing here can
   * reach the game's picture or its recording.
   *
   * The registered lines come first, then the frame-time figures, with the
   * sparkline standing beside them — the game's own vocabulary keeps the reading
   * order it was registered in, and the engine's numbers sit under it rather than
   * pushing it down the panel.
   *
   * Nothing is drawn when the overlay is off, and nothing is drawn when there is
   * nothing to say — no registered sources and no frames timed yet. An empty panel
   * is chrome that hides the game for no information.
   */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.on) return;

    const metrics = this.metrics();
    const lines = Object.entries(this.read()).map(
      ([name, value]) => `${name}: ${formatValue(value)}`,
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
      // lost context), whatever style the overlay set must still come back.
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

/* -------------------------------------------------------------------------- */
/* The overlay surface                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The engine-owned 2D surface the overlay draws on, composited above the
 * rendering canvas.
 *
 * The rendering canvas yielded a WebGL2 context and therefore yields no 2D one,
 * so the overlay's chrome needs a surface of its own. The engine calls
 * {@link OverlaySurface.sync} once per frame — before the overlay draws, and
 * whether or not it is enabled, so a panel toggled off leaves no ghost behind —
 * and then hands {@link OverlaySurface.context} to {@link Diagnostics.draw}.
 */
export interface OverlaySurface {
  /** The surface's 2D context — what `Diagnostics.draw` receives. */
  context(): CanvasRenderingContext2D;
  /**
   * Track the rendering canvas's backing-store size and leave the surface blank:
   * resized to `width` × `height` device pixels, fully transparent, transform at
   * the identity. Called every frame, so last frame's panel never lingers.
   */
  sync(width: number, height: number): void;
  /**
   * Remove the surface from the document it was positioned in. Idempotent, and a
   * no-op for an offscreen surface, which has nowhere to be removed from.
   */
  dispose(): void;
}

/** Blank the surface: identity transform, then a full-size transparent clear. */
function blank(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
}

/**
 * The element-backed surface: a `<canvas>` positioned over the rendering canvas.
 *
 * Chosen when a document stands behind the canvas, because an element the document
 * composites is what actually puts the panel *above* the WebGL picture on screen.
 * The element is chrome, so it must never intercept the game's input:
 * `pointer-events: none` keeps every pointer event falling through to the canvas
 * and the listeners under it.
 */
function elementSurface(canvas: HTMLCanvasElement): OverlaySurface | null {
  // `ownerDocument` is typed non-optional but a canvas from outside the DOM — the
  // headless harness's, cast to HTMLCanvasElement — carries none; read it as the
  // runtime fact it is.
  const doc = canvas.ownerDocument as Document | null | undefined;
  if (!doc || typeof doc.createElement !== "function") return null;

  let element: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  try {
    element = doc.createElement("canvas");
    ctx = element.getContext("2d");
  } catch {
    return null;
  }
  // A document whose canvases yield no 2D context (jsdom without a native canvas
  // binding) cannot host the overlay either; the caller falls back from here.
  if (ctx === null) return null;
  const context = ctx;

  element.style.position = "absolute";
  element.style.pointerEvents = "none";
  // Beside the canvas rather than at the body's tail, so the overlay scrolls and
  // stacks with the picture it annotates.
  canvas.parentNode?.insertBefore(element, canvas.nextSibling);

  let disposed = false;
  return {
    context: () => context,
    sync(width: number, height: number): void {
      // Assigning the backing-store size clears the surface, so the explicit blank
      // is only needed when the size did not change.
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      blank(context, width, height);

      // Sit exactly over the canvas: same offset, same CSS size, so one overlay
      // device pixel covers one canvas device pixel. The CSS size is copied only
      // when the canvas reports one — a canvas outside layout reports zeros, and
      // writing those would collapse the overlay for no information.
      element.style.left = `${canvas.offsetLeft}px`;
      element.style.top = `${canvas.offsetTop}px`;
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        element.style.width = `${canvas.clientWidth}px`;
        element.style.height = `${canvas.clientHeight}px`;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      element.parentNode?.removeChild(element);
    },
  };
}

/** The `OffscreenCanvas` constructor, where this host has one. */
interface OffscreenLike {
  width: number;
  height: number;
  getContext(kind: "2d"): unknown;
}

/**
 * The offscreen surface: an `OffscreenCanvas` reached only through `draw`.
 *
 * Chosen over a supplied surface with no document behind the canvas — a browser
 * worker, or any host that can make a 2D surface without a DOM. Nothing composites
 * it anywhere; its whole observable behavior is that `draw` receives its context,
 * which is exactly what the docs promise ("reached through `draw`").
 */
function offscreenSurface(
  width: number,
  height: number,
): OverlaySurface | null {
  const Offscreen = (
    globalThis as {
      OffscreenCanvas?: new (w: number, h: number) => OffscreenLike;
    }
  ).OffscreenCanvas;
  if (typeof Offscreen !== "function") return null;

  let surface: OffscreenLike;
  let ctx: unknown;
  try {
    surface = new Offscreen(width, height);
    ctx = surface.getContext("2d");
  } catch {
    return null;
  }
  if (ctx === null || ctx === undefined) return null;
  // `OffscreenCanvasRenderingContext2D` draws with the same vocabulary; the overlay
  // uses nothing outside the shared surface API.
  const context = ctx as CanvasRenderingContext2D;

  return {
    context: () => context,
    sync(w: number, h: number): void {
      if (surface.width !== w) surface.width = w;
      if (surface.height !== h) surface.height = h;
      blank(context, w, h);
    },
    dispose(): void {
      // Nothing to detach: the surface was never in a document.
    },
  };
}

/**
 * Make the overlay's 2D surface for `canvas`, or report that none can exist.
 *
 * With a document behind the canvas the surface is a positioned element; without
 * one it is an `OffscreenCanvas`; and where neither can be made — Node, where
 * there is no document and no 2D `OffscreenCanvas` — the answer is `null` and the
 * overlay is inert: the engine draws nothing and calls `draw` on nothing, while
 * `read` and `metrics` answer as always. Returning `null` rather than throwing is
 * deliberate — a headless build is a documented environment, not an error.
 */
export function createOverlaySurface(
  canvas: HTMLCanvasElement,
): OverlaySurface | null {
  return (
    elementSurface(canvas) ?? offscreenSurface(canvas.width, canvas.height)
  );
}
