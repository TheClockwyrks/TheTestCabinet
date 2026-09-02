// Orrery — the entry point (specs/overview.md).
//
// Builds the runtime layer beneath the game — the canvas fit, the keyboard,
// the pointer, the audio bus, the diagnostics — stands the game on it,
// installs the debugging and automation surface on `window.__orrery`, and
// starts the frame loop. Nothing here decides a rule of the game; it wires the
// pieces together and hands the loop its canvas.

import { cueUrls } from "./assets";
import { AudioBus } from "./audio";
import { Diagnostics, registerGameDiagnostics } from "./diagnostics";
import { Game } from "./game";
import { Keyboard } from "./keyboard";
import { claimGestures, Pointer } from "./pointer";
import { Runtime } from "./runtime";
import { createSurface, installSurface } from "./surface";
import { computeFit, clientToStage, domSurface } from "./viewport";

function main(): void {
  const canvas = document.getElementById("stage");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Orrery: the page carries no canvas to draw on");
  }
  const ctx = canvas.getContext("2d");
  if (ctx === null)
    throw new Error("Orrery: a 2D canvas context is unavailable");

  const surface = domSurface(canvas);
  const audio = new AudioBus();
  const game = new Game({
    muted: () => audio.muted(),
    toggleMuted: () => audio.toggleMuted(),
    play: (cue) => audio.play(cue),
  });

  const keyboard = new Keyboard(window);
  const pointer = new Pointer(
    canvas,
    (clientX, clientY) =>
      clientToStage(
        computeFit(surface.cssWidth(), surface.cssHeight(), surface.dpr()),
        surface.origin(),
        surface.dpr(),
        clientX,
        clientY,
      ),
    canvas,
  );
  claimGestures(canvas);

  const diagnostics = new Diagnostics();
  registerGameDiagnostics(diagnostics, game);

  // Browsers wait for a gesture before a page may make a sound.
  keyboard.onFirstPress(() => audio.unlock());
  canvas.addEventListener("pointerdown", () => audio.unlock());

  const runtime = new Runtime({
    canvas,
    ctx,
    surface,
    game,
    keyboard,
    pointer,
    diagnostics,
    audio,
  });
  installSurface(createSurface(game, runtime));
  runtime.start();

  // Decoding is independent of the first frame: the game is playable and
  // silent until the clips are ready, and one that never arrives leaves it
  // that way (specs/assets.md).
  void audio.load(cueUrls());
}

main();
