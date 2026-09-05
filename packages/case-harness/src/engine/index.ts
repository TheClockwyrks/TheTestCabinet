// @clockwyrks/case-harness/engine — the shared harness for an ENGINE-BACKED
// validator project. THE DIMENSION-NEUTRAL BARREL.
//
// WHAT THIS HALF IS. Under an engine a case's validators run in the SAME PROCESS
// as the build: they import the engine and the build's own modules, construct an
// engine over a canvas the harness owns and a clock the check chose, and step the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes — a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied. The engineless half one
// directory up does the opposite of all of that, for the opposite reason: with no
// engine there is nothing to import, so the only place the build exists is a page.
//
// THE PACKAGE NAMES NO ENGINE, and cannot: there are four of them and a case's
// project has exactly one on its import graph. Everything engine-shaped arrives
// as an injected VALUE through `./kit`'s config, and what this package knows
// about an engine is the structural contract in `./contract`.
//
// THREE BARRELS, AND WHY.
//
//   ./index  (this file) — everything that is true of all four engines: the
//            contract, the events, the surface, the drivers, the canvas the
//            engine draws through, the sweep, the cue stamping, the evidence
//            writer, and the kit that binds them.
//   ./2d     — the 2D-only readings: the pixel, colour and placed-text readings
//            over the canvas, and the replay stack that thins and re-tables a 2D
//            engine's draw-op recording.
//   ./3d     — the 3D-only pieces: the WebGL2 stub a renderer stands up over.
//
// A 3D CASE MUST NOT DRAG IN THE 2D REPLAY STACK, AND A 2D CASE MUST NOT DRAG IN
// THE 3D ONE. That is not tidiness. A 3D engine's `stopRecording` answers a
// promise of VP9 VIDEO and its contract declares no `DrawOp`, `DrawState`,
// `PathSegment` or `CapturedImage` at all, so the 2D replay stack has nothing to
// operate on there; and a 3D project's renderer stands up over a WebGL2 stub that
// a 2D project has no use for. Neither half is reachable from this file, so
// importing the neutral barrel costs a case neither.
//
// WHERE THE LINE FALLS, EXACTLY. The canvas and its recorder are HERE rather than
// in `./2d`, because all four engines draw through a 2D context — the two 3D ones
// over a `@napi-rs/canvas` SCREEN layer beside their WebGL stub, which is where
// their HUD is really drawn and what their stills are encoded from. A STILL is
// here for the same reason. What is NOT here is the REPLAY: `./2d`'s
// `makeReplayCapture` thins and re-tables a 2D engine's draw-op log, and a 3D
// engine's `stopRecording` answers something else entirely, so a 3D case
// importing this barrel reaches none of that stack — and a 2D case importing it
// reaches none of `./3d`.
//
// WHAT IS DELIBERATELY NOT RE-EXPORTED HERE: `./vitest-config`. It is loaded by
// vite's own config path before the test runtime exists, and it is the file whose
// failure mode is "the project would not load at all"; reaching it through this
// barrel would drag the whole package into every worker for one function no suite
// ever calls. A case's `vitest.config.ts` imports that specifier directly. This
// is the same rule `../index` states for its own two config-path modules, and it
// is stated again here rather than inherited because the reason is the same and
// the file is a different one.

/* What this package knows about an engine, and how little that is. */
export * from "./contract";

/* The events a check raises on the engine's own event target. */
export * from "./events";

/* Where the debug surface comes from, and what stands in when there is none. */
export * from "./surface";

/* How a check calls that surface: the three driver strategies. */
export * from "./driver";

/* The canvas the engine draws through, and the recorder over it. */
export * from "./canvas";

/* Writing a review item's evidence out. */
export * from "./capture";

/* One case, one engine, one call. */
export * from "./kit";
