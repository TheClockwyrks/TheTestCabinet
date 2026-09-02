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
import { Effects } from "./effects";
import { Game } from "./game";
import { ImageStore } from "./images";
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

  const sprites = new ImageStore();
  const effects = new Effects();

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
    sprites,
    effects,
  });
  // The surface is installed as soon as the game has initialized, before the
  // assets are waited on, so a scenario driven from code never waits on a file
  // (specs/instrumentation.md).
  installSurface(createSurface(game, runtime));

  // Every image is decoded and every sound is bound to its cue before the
  // first frame draws. Each load is guarded on its own, so a file that is
  // missing or will not decode simply leaves that sprite undrawn and that cue
  // silent, and the loop starts either way (specs/assets.md).
  void Promise.all([sprites.load(), audio.load(cueUrls())])
    .catch(() => undefined)
    .finally(() => {
      runtime.start();
    });
}

main();
