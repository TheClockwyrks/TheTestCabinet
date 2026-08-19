/**
 * The debug overlay: a read-only window onto values the *game* names.
 *
 * The engine cannot know what is worth watching in someone else's simulation, so it
 * does not guess: a game registers named sources and the engine owns everything
 * around them — the panel, the toggle key, and the read the host interface exposes
 * to a driver. That split is what makes the overlay useful to both audiences at
 * once. A human presses the toggle and sees the same numbers a validation script
 * reads back through `diagnostics()`, with no second code path to keep in sync.
 *
 * Two rules follow from "read-only", and both are enforced here rather than left to
 * the game's good behaviour:
 *
 * - A source that throws is contained. A diagnostic exists to explain a failure, so
 *   it must never be the cause of one — a throwing source yields its error message
 *   as its value and the rest of the panel draws normally.
 * - {@link Diagnostics.draw} saves and restores the 2D context around everything it
 *   does. The overlay draws *after* the game's own frame, and a leaked `fillStyle`
 *   or `font` would silently restyle the next frame's drawing — a bug that looks
 *   like it lives in the game.
 */
/** Where the panel sits, and how much air the text gets, in logical pixels. */
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
/** The message to show for a source that threw, from whatever it threw. */
function failureText(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * The registry behind the engine's `diagnostics` facade and its `diagnostics()` /
 * `setOverlay()` host operations.
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
     * Evaluate every source.
     *
     * This is what a driver reads, and it is deliberately independent of whether the
     * overlay is *visible*: a validation script should not have to switch on a piece
     * of human-facing chrome to inspect the game's state.
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
     * Draw the panel top-left, sized to its own text and clamped to the
     * `width`/`height` of the surface it is drawn on.
     *
     * Those are *device* pixels, not logical ones: the engine resets the transform to
     * the identity before calling this, so the overlay is chrome measured in the
     * canvas's backing store rather than in the game's letterboxed coordinates. That
     * is what keeps debug text the same physical size and crisp however far the
     * game's own coordinates are being scaled.
     *
     * Nothing is drawn when the overlay is off, and nothing is drawn when no sources
     * are registered — an empty panel is chrome that hides the game for no
     * information.
     */
    draw(ctx, width, height) {
        if (!this.on)
            return;
        const lines = Object.entries(this.read()).map(([name, value]) => `${name}: ${formatValue(value)}`);
        if (lines.length === 0)
            return;
        // Scale with the surface height so the overlay stays readable on a tall canvas
        // without swallowing a short one, with a floor for legibility. Because the
        // height is in device pixels, this tracks the device pixel ratio for free.
        const fontSize = Math.max(11, Math.round(height * 0.02));
        const lineHeight = Math.round(fontSize * 1.4);
        ctx.save();
        try {
            ctx.font = `${fontSize}px ${FONT_STACK}`;
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            let widest = 0;
            for (const line of lines)
                widest = Math.max(widest, ctx.measureText(line).width);
            const panelWidth = Math.min(widest + PADDING * 2, Math.max(width - MARGIN * 2, 0));
            const panelHeight = Math.min(lines.length * lineHeight + PADDING * 2, Math.max(height - MARGIN * 2, 0));
            ctx.fillStyle = PANEL_FILL;
            ctx.fillRect(MARGIN, MARGIN, panelWidth, panelHeight);
            ctx.fillStyle = TEXT_FILL;
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i] ?? "", MARGIN + PADDING, MARGIN + PADDING + i * lineHeight);
            }
        }
        finally {
            // `finally`, not a trailing call: if measuring or drawing throws (a fake or a
            // lost context), the game's style must still come back.
            ctx.restore();
        }
    }
}
