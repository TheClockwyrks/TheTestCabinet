/**
 * `@test-cabinet/structured-3d` — the **Structured 3D** engine: the runtime a
 * produced 3D game is built *inside*.
 *
 * The package has one entry point, this module, and it is what a game and a
 * validator both import. `three` is a peer dependency: a build declares it itself
 * and imports it directly wherever it needs a three object, so the engine, the
 * build, and `@test-cabinet/voxel-runtime/three` share one instance. The engine
 * re-exports nothing from `three`.
 *
 * Where the Simple family hands a game a loop and a renderer, this engine hands it
 * an object model and owns everything around it: the gameplay framework — a game
 * instance that outlives every level, worlds built from level descriptions, a game
 * mode and game state that decide and record a match, actors assembled from
 * components, and controllers that possess and drive pawns — the frame loop and the
 * replaceable clock that decides what each frame is worth, the letterboxed
 * device-pixel-ratio-aware fit from the logical design size onto the element, the
 * camera whose frustum projects world units into that field, the pipeline that
 * collects every enabled, visible render component and draws it through a
 * `THREE.WebGLRenderer` under one of four render modes, the 2D screen layer
 * composited over that picture, volumetric collision detection reported as events
 * and manifolds, named input actions read only through a player controller, the
 * audio cue bus with its positional cues and its first-gesture unlock, asset
 * resolution under one fixed root, the diagnostics overlay, the recorder that
 * captures the frames the pipeline drew as video, and the debug surface the game
 * instance returned from its `initialize`.
 *
 * The game owns the levels it registers, the game modes that hold its rules, the
 * actors and components that populate a world, and the controllers that drive its
 * pawns. A build writes subclasses; the engine constructs, ticks, renders, and
 * tears down, in a fixed order, and detection belongs to the engine while response
 * belongs to the game — nothing the engine reports moves anything.
 */

export {};
