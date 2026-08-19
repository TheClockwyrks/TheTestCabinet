// Carom — bootstrap.
//
// Everything that is the same in every browser game is the engine's: the frame
// loop and the delta time it measures, fitting the fixed 1280x720 logical field
// into the canvas (the uniform scale, the centered letterbox, the device pixel
// ratio, and the resync when any of them changes), the keyboard, the audio graph
// and its first-interaction unlock, and the debug overlay. None of it appears
// here, and none of it appears anywhere else in this project.
//
// What is left is the game: register the actions it is driven by, declare the cues
// it plays, build the world, name the values worth watching, publish the debug
// handle, and hand the engine the two functions that are genuinely Carom's —
// `update(dt)` and `render(ctx)`.

import { createEngine } from "@test-cabinet/simple-2d";
import { defineCues } from "./audio";
import { COLOR, FIELD_H, FIELD_W } from "./constants";
import { installDebugApi, registerDiagnostics } from "./debug";
import { Game } from "./game";
import { LAYOUT, registerActions } from "./input";
import { render } from "./render";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Carom: the #stage canvas is missing from the page");

const engine = createEngine({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized by
  // CSS alone (index.html); the engine maps this field onto whatever size that
  // gives it, so no code here ever reads the window.
  width: FIELD_W,
  height: FIELD_H,
  background: COLOR.bg,
  // Two paddles facing each other across the field: one vertical slider per side.
  layout: LAYOUT,
});

registerActions(engine);
defineCues(engine);

const game = new Game(engine);

registerDiagnostics(engine, game);

// Install the debugging and automation API on window.__carom (see debug.ts and
// specs/instrumentation.md). Inert during normal play.
installDebugApi(game);

engine.frame.run({
  // `dt` is the real elapsed SECONDS of this frame, already clamped by the engine
  // so a backgrounded tab cannot hand the simulation a multi-second step.
  update: (dt) => game.update(dt),
  // The context arrives cleared and already carrying the logical transform, so the
  // renderer draws in 1280x720 coordinates and nothing else.
  render: (ctx) => render(ctx, game),
});
