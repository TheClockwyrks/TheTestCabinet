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
import type { FrameMetrics } from "./contract";
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
    metrics(): FrameMetrics;
    /** The window's samples in milliseconds, oldest first, owned by the loop. */
    series(): readonly number[];
}
/**
 * The registry behind the engine's `diagnostics` facade and its overlay toggle key.
 */
export declare class Diagnostics {
    /**
     * Insertion-ordered, and re-registering a name deliberately keeps the original
     * position (a `Map` set on an existing key does not move it): a value the game
     * re-registers mid-run should not make every line below it jump.
     */
    private readonly sources;
    private on;
    /**
     * The frame loop's timing, assignable so the engine can wire the two together in
     * whichever order it builds them. It is a plain field rather than a constructor
     * requirement because a `Diagnostics` is perfectly meaningful without a loop — it
     * simply reports an empty window until one is attached.
     */
    timings: FrameTimings;
    constructor(timings?: FrameTimings);
    /**
     * Name a value for the overlay. The source is called on every read, not sampled
     * at registration, so it always reports the live state.
     */
    register(name: string, source: () => unknown): void;
    /** Show or hide the overlay. */
    setEnabled(enabled: boolean): void;
    /** Whether the overlay is currently drawn. */
    enabled(): boolean;
    /** Flip the overlay — what the engine's toggle key is wired to. */
    toggle(): void;
    /**
     * Evaluate every source, yielding a throwing source's error message as its value.
     *
     * {@link Diagnostics.draw} calls this once per drawn frame and formats the result
     * into the panel's lines, so what the panel shows is the simulation's live state.
     */
    read(): Record<string, unknown>;
    /**
     * The frame timing over the loop's current window.
     *
     * Read from the attached {@link Diagnostics.timings} rather than collected here.
     * {@link Diagnostics.draw} puts it under the game's own lines, beside the
     * sparkline, so the cost of a frame sits next to what the frame produced.
     */
    metrics(): FrameMetrics;
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
    draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
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
    private drawGraph;
}
//# sourceMappingURL=diagnostics.d.ts.map