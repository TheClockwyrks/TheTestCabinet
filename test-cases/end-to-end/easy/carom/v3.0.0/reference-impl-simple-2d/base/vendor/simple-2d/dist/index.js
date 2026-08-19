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
import { Diagnostics } from "./diagnostics";
import { FrameLoop } from "./frame";
import { installHost } from "./host";
import { InputRegistry } from "./input";
import { applyViewport, syncCanvas } from "./viewport";
/**
 * The key that toggles the debug overlay.
 *
 * Backtick, because it is the traditional debug-console key and no 2D game binds
 * it for gameplay. It is handled by a listener the engine owns rather than by a
 * registered action, deliberately: `actions()` is the static read a driver uses to
 * confirm that a build bound everything its case asked for, and it stays exactly
 * that — the game's vocabulary — only if the engine keeps its own chrome out of it.
 */
const OVERLAY_TOGGLE_CODE = "Backquote";
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
export function createEngine(options) {
    const { canvas, width, height } = options;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`createEngine needs a positive logical design size, got ${width}x${height}`);
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("createEngine could not get a 2D context from the canvas; the engine renders through it");
    }
    // The canvas's *own* document, not the ambient one: a game rendered inside an
    // iframe (a run's preview pane) must listen where its own key events are, and
    // installing its host interface on the outer window would put it out of a
    // driver's reach.
    const doc = canvas.ownerDocument ?? document;
    const view = doc.defaultView ?? globalThis;
    const input = new InputRegistry(doc);
    if (options.layout !== undefined)
        input.useLayout(options.layout);
    const audio = new AudioBus();
    const assets = new AssetLoader();
    const diagnostics = new Diagnostics();
    const loop = new FrameLoop({ context: () => ctx });
    // Cue timestamps come from the frame clock rather than the wall clock. Under a
    // manual clock no real time passes at all, so a `performance.now()` stamp would
    // put every cue of a 600-frame `advance` at the same instant; against the frame
    // clock, a cue's `t` lines up with the `frame().timeMs` a driver is asserting on.
    audio.now = () => loop.info().timeMs;
    // Sized once up front so `viewport()` and the game's own setup code see a real
    // fit before the first frame runs.
    let viewport = syncCanvas(canvas, width, height);
    /** Resize, clear and transform, in that order — the frame's blank page. */
    const prepare = () => {
        viewport = syncCanvas(canvas, width, height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (options.background === undefined) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        else {
            ctx.fillStyle = options.background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        applyViewport(ctx, viewport);
    };
    loop.onFrame(() => {
        // Identity transform: the overlay is chrome laid over the finished picture, not
        // part of it, so it is measured and drawn in device pixels rather than being
        // scaled — and letterboxed — along with the game's own coordinates.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        diagnostics.draw(ctx, canvas.width, canvas.height);
        input.endFrame();
    });
    const onOverlayKey = (event) => {
        // An auto-repeat would strobe the panel for as long as the key is held.
        if (event.code !== OVERLAY_TOGGLE_CODE || event.repeat)
            return;
        diagnostics.toggle();
    };
    doc.addEventListener("keydown", onOverlayKey);
    /**
     * Browsers refuse to start audio outside a user gesture, so the bus stays locked
     * until the player touches something. Listening in the capture phase means a game
     * that consumes its own canvas events cannot accidentally prevent the unlock, and
     * both listeners come off as soon as either fires — one gesture is all that is
     * needed, and {@link AudioBus.unlock} is idempotent regardless.
     */
    const unlockAudio = () => {
        audio.unlock();
        removeUnlockListeners();
    };
    const removeUnlockListeners = () => {
        doc.removeEventListener("pointerdown", unlockAudio, true);
        doc.removeEventListener("keydown", unlockAudio, true);
    };
    doc.addEventListener("pointerdown", unlockAudio, true);
    doc.addEventListener("keydown", unlockAudio, true);
    const uninstallHost = installHost({
        target: view,
        frame: loop,
        input,
        audio,
        assets,
        diagnostics,
    });
    let destroyed = false;
    return {
        frame: {
            run(cb) {
                // The game's callbacks are wrapped rather than handed to the loop directly,
                // because the per-frame canvas work has to happen *inside* the frame and
                // before the game touches the context. Wrapping keeps the loop ignorant of
                // the canvas — it owns when a frame happens, never what it draws on.
                loop.run({
                    update: (dt) => {
                        prepare();
                        cb.update(dt);
                    },
                    render: (context) => {
                        cb.render(context);
                    },
                });
            },
            stop: () => loop.stop(),
            info: () => loop.info(),
        },
        input,
        audio,
        assets,
        diagnostics,
        viewport: () => ({
            width: viewport.width,
            height: viewport.height,
            scale: viewport.scale,
            offsetX: viewport.offsetX,
            offsetY: viewport.offsetY,
        }),
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            loop.stop();
            input.detach();
            doc.removeEventListener("keydown", onOverlayKey);
            removeUnlockListeners();
            uninstallHost();
        },
    };
}
export { TOUCH_LAYOUTS } from "./layouts";
