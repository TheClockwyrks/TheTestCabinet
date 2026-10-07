// Kessler — the entry point (specs/overview.md).
//
// Loads the produced assets, builds the runtime layer beneath the game — the
// keyboard, the pointer, the audio bus, the particle effects, the
// diagnostics, and the frame loop — installs the debugging and automation surface on
// `window.__kessler`, and starts the loop. Nothing here decides a rule of
// the game; it wires the pieces together and hands the loop its canvas.

import { loadAssets } from "./assets";
import { WebAudioBus } from "./audio";
import { Diagnostics, registerGameDiagnostics } from "./diagnostics";
import { Fx } from "./fx";
import { Game } from "./game";
import { Keyboard, Pointer } from "./input";
import { Runtime } from "./runtime";
import { createApi, installApi } from "./surface";

async function main(): Promise<void> {
  const canvas = document.getElementById("stage");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Kessler: the page carries no canvas to draw on");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kessler: a 2D canvas context is unavailable");

  const assets = await loadAssets();
  const audio = new WebAudioBus();
  const fx = new Fx(assets);
  const game = new Game({
    cue: (cue) => audio.play(cue),
    particle: (system, x, y) => fx.spawn(system, x, y),
  });
  const keyboard = new Keyboard();
  const pointer = new Pointer();
  const diagnostics = new Diagnostics();
  registerGameDiagnostics(diagnostics, game, fx);

  keyboard.onFirstPress(() => audio.unlock());
  keyboard.attach();
  pointer.attach(canvas);
  // A click is a gesture too, and unlocking twice is harmless.
  window.addEventListener("pointerdown", () => audio.unlock());

  const runtime = new Runtime({
    canvas,
    ctx,
    game,
    assets,
    keyboard,
    pointer,
    diagnostics,
    audio,
    fx,
  });
  installApi(createApi(game, runtime, () => fx.clear()));
  runtime.start();

  // Decoding is independent of the first frame: the game is playable and
  // silent until the clips are ready, and one that never arrives leaves it
  // that way.
  void audio.load(assets);
}

void main();
