// Wick — the entry point (specs/overview.md).
//
// Loads the produced assets, builds the runtime layer beneath the game (the
// keyboard, the audio bus, the diagnostics, the frame loop), installs the
// debugging and automation surface on `window.__wick`, and starts the loop.
// Nothing here decides a rule of the game.

import { loadAssets } from "./assets";
import { WebAudioBus } from "./audio";
import { Diagnostics, registerGameDiagnostics } from "./diagnostics";
import { Game } from "./game";
import { Keyboard } from "./input";
import { Runtime } from "./runtime";
import { createApi, installApi } from "./surface";

async function main(): Promise<void> {
  const canvas = document.getElementById("stage");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Wick: the page carries no canvas to draw on");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Wick: a 2D canvas context is unavailable");

  const audio = new WebAudioBus();
  const game = new Game({
    toggleMute: () => {
      audio.muted = !audio.muted;
    },
    isMuted: () => audio.muted,
  });
  const keyboard = new Keyboard();
  const diagnostics = new Diagnostics();
  registerGameDiagnostics(diagnostics, game);

  keyboard.onFirstPress(() => audio.unlock());
  keyboard.attach(window);
  window.addEventListener("pointerdown", () => audio.unlock());

  // Every image is decoded and every sound bound before the first frame.
  const assets = await loadAssets();
  await audio.load(assets.audioUrls);

  const runtime = new Runtime({
    canvas,
    ctx,
    game,
    assets,
    keyboard,
    diagnostics,
    audio,
  });
  installApi(createApi(game, runtime));
  runtime.start();
}

void main();
