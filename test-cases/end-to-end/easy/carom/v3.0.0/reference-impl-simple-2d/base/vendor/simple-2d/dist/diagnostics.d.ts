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
/**
 * The registry behind the engine's `diagnostics` facade and its `diagnostics()` /
 * `setOverlay()` host operations.
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
     * Evaluate every source.
     *
     * This is what a driver reads, and it is deliberately independent of whether the
     * overlay is *visible*: a validation script should not have to switch on a piece
     * of human-facing chrome to inspect the game's state.
     */
    read(): Record<string, unknown>;
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
    draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
}
