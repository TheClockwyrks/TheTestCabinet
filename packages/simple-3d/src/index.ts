/**
 * `@test-cabinet/simple-3d` — the **Simple 3D** engine: the runtime a produced 3D
 * game is built on, and the wiring that assembles it.
 *
 * The package has one entry point, this module, and it is what a game and a
 * validator both import. `three` is a peer dependency: a build declares it itself
 * and imports it directly wherever it needs a three object, so the engine, the
 * build, and `@test-cabinet/voxel-runtime/three` share one instance. The engine
 * re-exports nothing from `three`.
 *
 * The engine owns the parts of a browser game that are the same in every browser
 * game and are, every single time, re-derived slightly wrong: the frame loop and
 * the replaceable clock that decides what each frame is worth, the letterboxed
 * device-pixel-ratio-aware fit from the game's logical design size onto the
 * element, the renderer over the canvas with the retained scene and the camera it
 * draws through, the 2D screen layer composited over that picture, named input
 * actions over keyboard bindings and touch layouts, a pointer mapped into the
 * game's own logical coordinates, the audio cue bus with its first-gesture unlock,
 * asset resolution under one fixed root, the diagnostics overlay, the recorder that
 * captures the picture the game submitted as video, and the debug surface the game
 * returned beside its state.
 *
 * The game owns its simulation and its picture: an `initialize` that returns the
 * state and the debug surface, an `update` that takes the state and a delta and
 * returns the next state, and a `render` that populates the scene, poses the
 * camera, and draws the screen layer. The engine holds the state by value and hands
 * every reader a read-only view, so rendering cannot change the state and nothing
 * but a transition advances it.
 */

export {};
