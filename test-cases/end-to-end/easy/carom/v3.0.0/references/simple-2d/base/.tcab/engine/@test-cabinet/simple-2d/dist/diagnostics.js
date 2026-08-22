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
 * Three rules follow from "read-only", and all three are enforced here rather than
 * left to the game's good behaviour:
 *
 * - A source that throws is contained. A diagnostic exists to explain a failure, so
 *   it must never be the cause of one — a throwing source yields its error message
 *   as its value and the rest of the panel draws normally.
 * - {@link Diagnostics.draw} saves and restores the 2D context around everything it
 *   does. The overlay draws *after* the game's own frame, and a leaked `fillStyle`
 *   or `font` would silently restyle the next frame's drawing — a bug that looks
 *   like it lives in the game.
 * - Nothing accumulates. The registry is keyed by the names the game registers,
 *   which are declared once during initialization, and the frame timing is *read*
 *   from the loop rather than collected here. A run of any length leaves this module
 *   holding exactly as much as a run of one frame does.
 */
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
 * What the overlay reads before a loop has been attached.
 *
 * An engine is constructed before it has run anything, and a `Diagnostics` may be
 * built, read and drawn in that state (a test, or a build whose overlay is switched
 * on before the first frame). An empty window is the honest answer, and it keeps
 * every caller free of a "no loop yet" branch.
 */
const IDLE_TIMINGS = {
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
function formatValue(value) {
    if (typeof value === "string")
        return value;
    if (typeof value === "number")
        return Number.isInteger(value) ? String(value) : value.toFixed(3);
    if (value === null || value === undefined)
        return String(value);
    if (typeof value === "object") {
        try {
            return JSON.stringify(value) ?? String(value);
        }
        catch {
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
function formatMs(ms) {
    return ms.toFixed(1);
}
/** The engine's own line: the three figures that say whether frames are even. */
function metricsLine(metrics) {
    const mean = formatMs(metrics.meanMs);
    const tail = `${formatMs(metrics.p95Ms)} / ${formatMs(metrics.p99Ms)}`;
    return `frame: ${mean} / ${tail} ms`;
}
/** The message to show for a source that threw, from whatever it threw. */
function failureText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** The tallest sample the graph has to fit, never below the floor. */
function graphCeiling(series) {
    let ceiling = GRAPH_FLOOR_MS;
    for (const sample of series) {
        if (Number.isFinite(sample) && sample > ceiling)
            ceiling = sample;
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
    sources = new Map();
    on = false;
    /**
     * The frame loop's timing, assignable so the engine can wire the two together in
     * whichever order it builds them. It is a plain field rather than a constructor
     * requirement because a `Diagnostics` is perfectly meaningful without a loop — it
     * simply reports an empty window until one is attached.
     */
    timings;
    constructor(timings = IDLE_TIMINGS) {
        this.timings = timings;
    }
    /**
     * Name a value for the overlay. The source is called on every read, not sampled
     * at registration, so it always reports the live state.
     */
    register(name, source) {
        this.sources.set(name, source);
    }
    /** Show or hide the overlay. */
    setEnabled(enabled) {
        this.on = enabled;
    }
    /** Whether the overlay is currently drawn. */
    enabled() {
        return this.on;
    }
    /** Flip the overlay — what the engine's toggle key is wired to. */
    toggle() {
        this.on = !this.on;
    }
    /**
     * Evaluate every source, yielding a throwing source's error message as its value.
     *
     * {@link Diagnostics.draw} calls this once per drawn frame and formats the result
     * into the panel's lines, so what the panel shows is the simulation's live state.
     */
    read() {
        const values = {};
        for (const [name, source] of this.sources) {
            try {
                values[name] = source();
            }
            catch (error) {
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
    metrics() {
        return this.timings.metrics();
    }
    /**
     * Draw the panel top-left, sized to its own contents and clamped to the
     * `width`/`height` of the surface it is drawn on.
     *
     * Those are *device* pixels, not logical ones: the engine resets the transform to
     * the identity before calling this, so the overlay is chrome measured in the
     * canvas's backing store rather than in the game's letterboxed coordinates. That
     * is what keeps debug text the same physical size and crisp however far the
     * game's own coordinates are being scaled.
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
    draw(ctx, width, height) {
        if (!this.on)
            return;
        const metrics = this.metrics();
        const lines = Object.entries(this.read()).map(([name, value]) => `${name}: ${formatValue(value)}`);
        if (metrics.samples > 0)
            lines.push(metricsLine(metrics));
        if (lines.length === 0)
            return;
        // The series is only *read* here, never held: whatever the loop hands back is
        // plotted this frame and forgotten.
        const series = metrics.samples > 0 ? this.timings.series() : [];
        // Scale with the surface height so the overlay stays readable on a tall canvas
        // without swallowing a short one, with a floor for legibility. Because the
        // height is in device pixels, this tracks the device pixel ratio for free.
        const fontSize = Math.max(11, Math.round(height * 0.02));
        const lineHeight = Math.round(fontSize * 1.4);
        const graphWidth = series.length > 0 ? Math.round(fontSize * GRAPH_WIDTH_EMS) : 0;
        const graphHeight = series.length > 0 ? lineHeight * GRAPH_HEIGHT_LINES : 0;
        ctx.save();
        try {
            ctx.font = `${fontSize}px ${FONT_STACK}`;
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            let textWidth = 0;
            for (const line of lines)
                textWidth = Math.max(textWidth, ctx.measureText(line).width);
            const contentWidth = textWidth + (graphWidth > 0 ? PADDING + graphWidth : 0);
            const contentHeight = Math.max(lines.length * lineHeight, graphHeight);
            const panelWidth = Math.min(contentWidth + PADDING * 2, Math.max(width - MARGIN * 2, 0));
            const panelHeight = Math.min(contentHeight + PADDING * 2, Math.max(height - MARGIN * 2, 0));
            ctx.fillStyle = PANEL_FILL;
            ctx.fillRect(MARGIN, MARGIN, panelWidth, panelHeight);
            const left = MARGIN + PADDING;
            const top = MARGIN + PADDING;
            ctx.fillStyle = TEXT_FILL;
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i] ?? "", left, top + i * lineHeight);
            }
            if (graphWidth > 0) {
                this.drawGraph(ctx, series, left + textWidth + PADDING, top, graphWidth, graphHeight);
            }
        }
        finally {
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
    drawGraph(ctx, series, x, y, width, height) {
        ctx.fillStyle = GRAPH_BACK_FILL;
        ctx.fillRect(x, y, width, height);
        const ceiling = graphCeiling(series);
        const columnWidth = width / series.length;
        ctx.fillStyle = GRAPH_BAR_FILL;
        for (let i = 0; i < series.length; i++) {
            const sample = series[i] ?? 0;
            // A sample above the ceiling cannot happen (the ceiling is the maximum), but
            // clamping keeps a non-finite one from drawing a bar of `NaN` height.
            const fraction = Number.isFinite(sample) ? Math.min(Math.max(sample, 0) / ceiling, 1) : 0;
            const barHeight = fraction * height;
            const barWidth = Math.max(columnWidth, 1);
            ctx.fillRect(x + i * columnWidth, y + height - barHeight, barWidth, barHeight);
        }
    }
}
//# sourceMappingURL=diagnostics.js.map