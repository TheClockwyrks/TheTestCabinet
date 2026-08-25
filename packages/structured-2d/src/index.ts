/**
 * `@test-cabinet/structured-2d` — the **Structured 2D** engine: the runtime a
 * produced 2D game is built *inside*.
 *
 * Where the Simple family hands a game a loop and a context, this engine hands
 * it an object model and owns everything around it:
 *
 * - **The gameplay framework** — a {@link GameInstance} that outlives every
 *   level, worlds built from level descriptions, a {@link GameMode} and
 *   {@link GameState} that decide and record a match, {@link Actor}s assembled
 *   from {@link Component}s, and {@link Controller}s that possess and drive
 *   {@link Pawn}s. A build writes subclasses; the engine constructs, ticks,
 *   renders, and tears down, in a fixed order.
 * - **The frame loop and its delta time** — a replaceable clock answers how
 *   much each frame is worth, so the sequence a validator steps through
 *   synchronously is the sequence a reviewer watches play.
 * - **Rendering** — engine-owned: the pipeline collects every enabled, visible
 *   render component, orders it by layer, spawn, and attachment, and draws it
 *   under one of four render modes, with a {@link DrawComponent} as the
 *   direct-drawing path.
 * - **Collision** — detection belongs to the engine, response to the game:
 *   channels and responses declare what is tested, events and manifolds report
 *   what was found, and nothing is moved.
 * - **The canvas fit and the camera** — a letterboxed, centred,
 *   device-pixel-ratio-aware map from the logical design size onto the element,
 *   resynced every frame, with the world's camera projecting world units into
 *   it.
 * - **Input** — named actions over `KeyboardEvent.code` bindings and a closed
 *   catalogue of touch layouts, read only through a player controller, with
 *   edges consumed per controller.
 * - **Audio** — cues played by name, synthesized or file-backed, and the
 *   first-gesture unlock a browser insists on.
 * - **Assets** — resolution and loading under one fixed root.
 * - **Diagnostics** — an overlay of values the game names, its frame-time
 *   graph, and the key that toggles it.
 * - **Draw-command recording** — an opt-in flight recorder over the drawing
 *   context, so a scenario a check drove replays as the operations the build
 *   issued.
 * - **The debug surface** — the value the game instance's `initialize`
 *   returns, held and handed back off the engine, so a check poses a scenario
 *   through the engine it built rather than through the page the build is
 *   drawn on.
 *
 * The package has one entry point — this module — providing `createEngine`,
 * the framework classes, the built-in components, the clocks, `TOUCH_LAYOUTS`,
 * the viewport functions, `RECORDING_FORMAT`, and every type a game or a
 * validator names. Everything the engine observes it broadcasts as an event a
 * caller subscribes to, rather than accumulating a log.
 *
 * ```ts
 * const engine = createEngine({ canvas, width: 640, height: 360, game });
 * await engine.initialize();
 * await engine.run({ signal: controller.signal });
 * ```
 */

export { createEngine } from "./engine";

export { GameInstance } from "./game-instance";
export { GameMode, GameState, PlayerState } from "./game-mode";
export { Actor, Pawn } from "./actors";
export {
  CameraComponent,
  Component,
  DrawComponent,
  RenderComponent,
  ShapeComponent,
  SpriteComponent,
  TextComponent,
} from "./components";
export { ColliderComponent } from "./collision";
export { AIController, Controller, PlayerController } from "./controllers";

export {
  ConstantClock,
  JitterClock,
  PacedClock,
  SequenceClock,
  WallClock,
} from "./clocks";
export type { PacedClockOptions } from "./clocks";
export { TOUCH_LAYOUTS } from "./input";
export { applyViewport, fitViewport, syncCanvas } from "./camera";
export { RECORDING_FORMAT } from "./recording";

/**
 * The whole shared vocabulary, re-exported wholesale.
 *
 * `contract.ts` *is* the package's type surface — it exists precisely so that
 * the engine, the framework classes, and the recording format cannot drift
 * apart — and re-exporting it as a list would add another place for a type to
 * be forgotten in. The contract module holds no runtime values, so nothing but
 * types crosses.
 */
export type * from "./contract";
