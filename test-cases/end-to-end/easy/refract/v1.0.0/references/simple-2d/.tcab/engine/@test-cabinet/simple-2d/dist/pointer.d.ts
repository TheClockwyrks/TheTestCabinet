/**
 * The pointer: the engine's single answer to "where is the player pointing, and
 * are they holding?".
 *
 * A game never reads `PointerEvent`s. The engine listens on the same target its
 * key listeners go on, maps each event's client position through the letterboxed
 * fit the game draws under, and hands `update` positions in the game's own
 * logical coordinates — through {@link UpdateApi.input} — so the device pixel
 * ratio and the letterbox bars never appear in game code. The pointer is the one
 * input whose meaning depends on where the picture is, and every pointer game
 * otherwise re-derives that conversion slightly wrong.
 *
 * Two reads serve two designs. The snapshot answers "where now, and held?",
 * which is what aiming needs. The per-frame sample list holds every position
 * delivered since the input frame last closed, in arrival order, which is what
 * direct manipulation needs: a sweep that crossed several targets between two
 * frames arrives as the ordered positions it visited rather than as the last
 * one alone.
 *
 * **Nothing here grows with the length of a run.** The sample list is cleared
 * every time the frame loop closes the input frame, and it is bounded at
 * {@link POINTER_SAMPLE_CAP} in between, so a burst of events between two frames
 * — or a run whose frames have stopped closing — costs a fixed amount however
 * long it goes on. A sample past the cap still moves the snapshot and the
 * edges; only its place in the list is refused.
 */
import type { PointerSample, PointerSnapshot, SurfaceMetrics, Viewport } from "./contract";
/**
 * The most samples one frame lists.
 *
 * Browsers coalesce `pointermove` to roughly one per animation frame, so a real
 * player produces a handful of samples per frame and never approaches this. The
 * cap exists for the frames that stop closing — a hidden tab whose animation
 * callbacks are suspended while the pointer keeps streaming — where an unbounded
 * list would grow for as long as the tab stays hidden.
 */
export declare const POINTER_SAMPLE_CAP = 1024;
export declare class PointerInput {
    #private;
    /**
     * Attaches to the target the surface supplies, immediately, for the same
     * reason the key listeners do (see `InputRegistry`): it is the one seam an
     * engine with no document behind it still has, and a caller that dispatches a
     * pointer-shaped event at it reaches the game by the path a player's pointer
     * takes.
     */
    constructor(surface: SurfaceMetrics, viewport: () => Viewport);
    /** The most recent position and hold, as a fresh copy the caller owns. */
    snapshot(): PointerSnapshot;
    /**
     * Whether the pointer was pressed since the last frame — true exactly once per
     * armed edge, then consumed, for the same reason an action's `pressed` is: a
     * menu and a gameplay layer both asking in one frame must not both act on one
     * press.
     */
    pressed(): boolean;
    /** Whether the pointer was released since the last frame; consumed on read. */
    released(): boolean;
    /**
     * The samples delivered since the input frame last closed, in arrival order,
     * as a fresh copy. Not consumed on read: the list is a record of the frame's
     * path rather than an edge, and two readers of one frame read one path.
     */
    samples(): PointerSample[];
    /**
     * Closes the pointer's input frame: the sample list empties and unconsumed
     * edges are discarded. Called by the frame loop beside the action registry's
     * `endFrame`, so a press is news for exactly one frame here too.
     */
    endFrame(): void;
    /** Detaches the pointer listeners. Idempotent, because teardown races. */
    detach(): void;
}
//# sourceMappingURL=pointer.d.ts.map