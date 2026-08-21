/**
 * `@test-cabinet/simple-2d` — the **Simple 2D** engine: the runtime a produced 2D
 * game is built on, and the wiring that assembles it.
 *
 * The engine owns the parts of a browser game that are the same in every browser
 * game and are, every single time, re-derived slightly wrong:
 *
 * - **The frame loop and its delta time** — a replaceable {@link Clock} answers how
 *   much each frame is worth, so the sequence a validator steps through
 *   synchronously is the sequence a reviewer watches play.
 * - **The canvas fit** — a letterboxed, centred, device-pixel-ratio-aware map from
 *   the game's fixed logical design size onto whatever size the page gave the
 *   element, resynced every frame so a resize needs no handler at all.
 * - **Input** — named actions over `KeyboardEvent.code` bindings and a closed
 *   catalogue of touch layouts, with edge detection done once and correctly.
 * - **Audio** — cues played by name, synthesized or file-backed, and the
 *   first-gesture unlock a browser insists on.
 * - **Assets** — resolution and loading under one fixed root.
 * - **Diagnostics** — an overlay of values the game names, its frame-time graph,
 *   and the key that toggles it.
 * - **Draw-command recording** — an opt-in flight recorder over the drawing context,
 *   so a scenario a check drove can be replayed as the operations the build issued.
 *
 * This module is the wiring and nothing else: every behaviour above belongs to a
 * subsystem beside it, and what is decided *here* is which subsystem talks to which,
 * and in what order a frame's steps happen. Three of those decisions are worth
 * stating up front, because a game and a validator both depend on them:
 *
 * 1. **Construction runs no game code.** {@link createEngine} validates, builds, and
 *    returns. The game's own `initialize` runs later, from
 *    {@link Engine.initialize}, which is what lets a caller subscribe to
 *    {@link Engine.events} first and observe the game's loading as it happens
 *    instead of inferring it afterwards.
 * 2. **Observation is by event.** Nothing here accumulates a log of what a run did.
 *    A subscriber keeps exactly what it decided was worth keeping, and the engine's
 *    footprint is the same after a million frames as after one.
 * 3. **Every measurement goes through a {@link SurfaceMetrics}.** The element's
 *    size, the device pixel ratio, and the target the key listeners go on all
 *    arrive through that one seam, so the same engine runs over a canvas in a page
 *    and over a native canvas with no document behind it.
 *
 * ```ts
 * const engine = createEngine({ canvas, width: 640, height: 360, game });
 * await engine.initialize();
 * await engine.run({ signal: controller.signal });
 * ```
 */
import type { Engine, EngineOptions } from "./contract";
/**
 * Build an engine over `options.canvas`, bound to `options.game`, and wire its
 * parts together.
 *
 * Synchronous, and it runs no game code: it validates its arguments, builds the
 * subsystems, and attaches the engine's own listeners. The game's `initialize`
 * runs from {@link Engine.initialize} and the
 * first frame from {@link Engine.run} or {@link Engine.advance}, so an engine
 * exists — subscribable, with its clock replaceable — before anything the game
 * does is observable.
 *
 * The per-frame order is the engine's real contribution, and it is what a game gets
 * for free:
 *
 * 1. **Before `update`** the canvas is resynced to its element and the device pixel
 *    ratio, the frame is cleared, and the viewport transform is applied. Doing this
 *    every frame rather than from a `resize` handler is what makes the fit correct
 *    on first paint, after a window resize, after a device-pixel-ratio change, and
 *    after a layout change no `resize` event fires for — with no handler at all, and
 *    no chance of the first frame drawing into a canvas that was never sized.
 * 2. **`update` runs with `dt` in seconds**, reading input and playing cues through
 *    an API that cannot draw.
 * 3. **`render` receives the prepared context**, so the game draws in logical
 *    coordinates and letterboxing simply does not appear in its code — through an
 *    API that cannot read input or play a cue, which is what leaves a frame's
 *    audible and observable behaviour entirely to the update.
 * 4. **After `render`** the transform is reset and the overlay is drawn in device
 *    space, so debug text stays the same physical size however far the game's own
 *    coordinates are being scaled, and the input frame is closed so an
 *    edge-triggered action is consumed exactly once.
 *
 * @throws if the design size is not finite and positive, if the canvas yields no 2D
 * context, or if `layout` is outside the catalogue. Each otherwise presents as a
 * build that runs and draws nothing, which is the most expensive kind of failure to
 * trace, so each is refused where it happens.
 */
export declare function createEngine<S>(options: EngineOptions<S>): Engine<S>;
export { ConstantClock, JitterClock, PacedClock, SequenceClock, WallClock } from "./clocks";
export type { PacedClockOptions } from "./clocks";
export { TOUCH_LAYOUTS } from "./layouts";
export { RECORDING_FORMAT } from "./recording";
export { applyViewport, fitViewport, syncCanvas } from "./viewport";
/**
 * The whole shared vocabulary, re-exported wholesale.
 *
 * `contract.ts` *is* the package's type surface — it exists precisely so that the
 * engine, the game-facing API, and the recording format cannot drift apart — and
 * re-exporting it as a list would add a fourth place for a type to be forgotten in.
 * The contract module holds no runtime values, so nothing but types crosses.
 */
export type * from "./contract";
//# sourceMappingURL=index.d.ts.map