// Gantry — the stage canvas the engine takes its `webgl2` context off.
// CASE-PROVIDED.
//
// WHY THIS FILE STILL EXISTS. Every check in this project runs in the same Node
// process as the build, over an engine the harness constructs itself. What the
// engine expects around it is a browser, and Node supplies none of it — so four
// facilities have to be stood up before an engine can be created at all:
//
//   1. THE STAGE CANVAS AND ITS WEBGL2 CONTEXT — this file.
//   2. THE SCREEN LAYER, a genuine `@napi-rs/canvas` the HUD is really drawn on.
//   3. `fetch`, over the workspace's own produced files.
//   4. AN `AudioContext`, for `decodeAudioData` alone.
//
// THREE OF THE FOUR ARE NO LONGER GANTRY'S. The WebGL2 stub answers three's
// requirements rather than this case's, and every 3D validator project in the
// tree needs the same one; the screen layer, the asset transport and the decoding
// audio context are the same in every ENGINE project, 2D or 3D. All of them now
// come from `@clockwyrks/case-harness` — `engine/3d`'s `createGlStub` and
// `defineSelfForThree`, `engine/index`'s recording canvas, `installAssetHost` and
// `installAudioContext` — and `harness.ts` binds them.
//
// WHAT IS LEFT HERE IS THE ONE PIECE THAT IS GANTRY'S: how this case's engine is
// STOOD UP over those parts. `createEngine` takes a `canvas` for the yard and a
// `screen` for the HUD, and the yard's canvas is an element that answers a
// `webgl2` context and attaches its listeners to the event target the harness
// owns. That shape is this case's, so it stays beside the case — and it stays in
// a file of its own, because everything in it is "the host, not the case", and
// keeping it apart is what stops it leaking into `harness.ts`, which is about
// Gantry.
//
// WHAT THIS IS NOT: a rasterizer, and it does not pretend to be one. Nothing in
// this project reads a pixel of the WORLD pass, because nothing in the harness
// Gantry's contract fixes can — the API is `snapshot`, `check`, `project`, `cues`
// and the input verbs — and every claim about the picture a validator makes is a
// claim about the render components the world holds, the objects the pipeline
// placed in `engine.scene`, and where the camera projects a world point. All of
// those are engine data that exist whether or not a driver rasterized anything.
// What the stub buys is the engine standing up at all, so the game's tick, its
// state, its debug surface and its cues can be driven.
//
// NOTHING HERE IS EVER SEEDED INTO A RUN. It is the case's validator project, and
// the build neither sees it nor is written against it.

import { createCanvas } from "@napi-rs/canvas";

import { createGlStub, defineSelfForThree } from "./case-harness/engine/3d";

/** What the three strings a renderer may log or surface name this stub as. */
const STUB_LABEL = "Gantry validator stub";

/**
 * The canvas the engine draws the yard through: a `webgl2` context that answers
 * three's queries and draws nothing, over the event target the harness dispatches
 * every gesture at.
 *
 * `width` and `height` are DEVICE pixels — the logical stage size times the
 * device pixel ratio the harness chose — because that is what a canvas's backing
 * store holds and what the engine resizes each frame.
 *
 * `events` is the harness's own target, the same one its `SurfaceMetrics` reports.
 * three attaches its context-lost listeners to the CANVAS rather than to the
 * surface, so the element forwards all three listener methods there and one target
 * carries both.
 */
export function createEngineSurface(
  width: number,
  height: number,
  events: EventTarget,
): HTMLCanvasElement {
  // three's renderer disposes through `self`, which a bare Node process has none
  // of; see the package's `defineSelfForThree` for what goes wrong without it.
  defineSelfForThree();

  // The engine's own recorder is the only thing that asks the STAGE canvas for a
  // 2D context, and this project never arms it — that recorder encodes with
  // WebCodecs, which Node has none of. It is supplied anyway so that a
  // `getContext("2d")` on the stage answers an object rather than `null`, as a
  // real canvas would.
  const backing = createCanvas(width, height);

  let gl: unknown;
  const stage = {
    width,
    height,
    // Read by three when it sizes itself against the element; the engine takes
    // every measurement through its `SurfaceMetrics` instead.
    style: {} as CSSStyleDeclaration,
    clientWidth: width,
    clientHeight: height,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    getContext(id: string): unknown {
      if (id === "webgl2") return (gl ??= createGlStub(stage, STUB_LABEL));
      if (id === "2d") return backing.getContext("2d");
      return null;
    },
  };

  return stage as unknown as HTMLCanvasElement;
}
