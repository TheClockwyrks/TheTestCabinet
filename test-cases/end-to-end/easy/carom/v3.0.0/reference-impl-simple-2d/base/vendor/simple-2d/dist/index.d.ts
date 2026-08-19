/**
 * `@test-cabinet/simple-2d` — the **Simple 2D** engine: the runtime a produced 2D
 * game is built on.
 *
 * The engine owns the parts of a browser game that are the same in every browser
 * game and are, every single time, re-derived slightly wrong:
 *
 * - **The frame loop and its delta time** — including the clamp that stops a
 *   backgrounded tab handing the simulation a multi-second step, and the
 *   replaceable clock that lets a driver run exactly N frames with exactly the
 *   deltas it chose.
 * - **The canvas fit** — a letterboxed, centred, device-pixel-ratio-aware map from
 *   the game's fixed logical design size onto whatever size the page gave the
 *   element, resynced every frame so a resize needs no handler at all.
 * - **Input** — named actions over `KeyboardEvent.code` bindings and a closed
 *   catalogue of touch layouts, with edge detection done once and correctly.
 * - **Audio** — synthesized cues played by name, the first-interaction unlock, and a
 *   semantic log of everything that played.
 * - **Assets** — resolution under one fixed root, with every request logged.
 * - **Diagnostics** — an overlay of values the game names, and its toggle key.
 * - **The host interface** — `window.__tcabEngine`, installed unconditionally, so a
 *   driver can operate any build of any case identically.
 *
 * The game supplies exactly two functions — `update(dt)` and `render(ctx)` — plus
 * the declarations that give the engine something to work with: its action
 * bindings, its cue definitions, and whatever it wants on the overlay. It writes its
 * own simulation and its own drawing, in logical coordinates, and touches no event
 * listener, no `requestAnimationFrame`, no `AudioContext`, and no canvas sizing code.
 *
 * ```ts
 * const engine = createEngine({ canvas, width: 640, height: 360 });
 * engine.input.register("thrust", { keys: ["ArrowUp", "KeyW"] });
 * engine.audio.define("blip", { freq: 880, durationMs: 90 });
 * engine.frame.run({
 *   update: (dt) => { ship.y -= engine.input.value("thrust") * SPEED * dt; },
 *   render: (ctx) => { ctx.fillRect(ship.x, ship.y, 8, 8); },
 * });
 * ```
 */
import { AssetLoader } from "./assets";
import { AudioBus } from "./audio";
import type { FrameCallbacks, FrameInfo } from "./contract";
import { Diagnostics } from "./diagnostics";
import { InputRegistry } from "./input";
import { type Viewport } from "./viewport";
/** What a game hands {@link createEngine}. */
export interface EngineOptions {
    /** The canvas the engine sizes, clears, and renders through. */
    canvas: HTMLCanvasElement;
    /** The logical design width the game draws in. */
    width: number;
    /** The logical design height the game draws in. */
    height: number;
    /**
     * A CSS colour cleared to before every frame. Omitted, the frame is cleared to
     * transparency instead, so a page can show through the canvas.
     */
    background?: string;
    /** A touch layout from the catalogue, whose vocabulary the game then registers. */
    layout?: string;
}
/**
 * The engine, as a game holds it.
 *
 * Every member is a subsystem the game *uses* rather than configures; there is no
 * lifecycle to manage beyond {@link Engine.destroy}, and no per-frame plumbing at
 * all — {@link Engine.frame}'s `run` is the last call a typical game makes.
 */
export interface Engine {
    /** The frame loop: start it, stop it, ask where it has got to. */
    readonly frame: {
        /** Start driving `cb`. Calling it again swaps the callbacks in place. */
        run(cb: FrameCallbacks): void;
        /** Stop the loop, dropping any frame already scheduled. */
        stop(): void;
        /** The frame counter, simulated time, and the most recent step. */
        info(): FrameInfo;
    };
    /** Named actions: register them, then read values and edges. */
    readonly input: InputRegistry;
    /** Named audio cues: define them, then play them. */
    readonly audio: AudioBus;
    /** Asset loading under the fixed asset root. */
    readonly assets: AssetLoader;
    /** Named values for the debug overlay. */
    readonly diagnostics: Diagnostics;
    /** The current logical-to-device fit, as a snapshot the caller owns. */
    readonly viewport: () => Viewport;
    /**
     * Tear the engine down: stop the loop, drop every listener, and unpublish the
     * host interface. Idempotent, because teardown races.
     */
    destroy(): void;
}
/**
 * Build an engine over `options.canvas` and wire its parts together.
 *
 * The wiring is the engine's real contribution, and it is worth being explicit
 * about what happens around each frame, because it is what a game gets for free:
 *
 * 1. **Before `update`** the canvas is resynced to its element and the device pixel
 *    ratio, the frame is cleared, and the viewport transform is applied. Doing this
 *    every frame rather than from a `resize` handler is what makes the fit correct
 *    on first paint, after a window resize, after a device-pixel-ratio change, and
 *    after a layout change no `resize` event fires for — with no handler at all, and
 *    no chance of the first frame drawing into a canvas that was never sized.
 * 2. **`render` receives the transformed context**, so the game draws in logical
 *    coordinates and letterboxing simply does not appear in its code.
 * 3. **After `render`** the overlay is drawn — with the transform reset, in device
 *    space, so debug text stays the same physical size and stays crisp regardless of
 *    how far the game's own coordinates are being scaled — and the input frame is
 *    closed so an edge-triggered action is consumed exactly once.
 *
 * @throws if the design size is not positive, or the canvas cannot give a 2D
 * context. Both are unrecoverable, and both otherwise present as a game that runs
 * but draws nothing — the most expensive kind of failure to trace.
 */
export declare function createEngine(options: EngineOptions): Engine;
export { TOUCH_LAYOUTS } from "./layouts";
export type { ActionBinding, ActionKind, AssetEvent, AudioState, ClockMode, CueEvent, CueSpec, FrameCallbacks, FrameInfo, RegisteredAction, Schedule, ScheduleFixed, ScheduleJitter, ScheduleSequence, TouchLayout, } from "./contract";
export type { AssetLoader } from "./assets";
export type { AudioBus } from "./audio";
export type { Diagnostics } from "./diagnostics";
export type { InputRegistry } from "./input";
export type { Viewport } from "./viewport";
