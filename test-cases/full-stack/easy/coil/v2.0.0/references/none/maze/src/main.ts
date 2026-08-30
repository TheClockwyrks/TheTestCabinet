// Coil — the entry point (specs/overview.md).
//
// Loads the produced assets, builds the runtime layer beneath the game — the
// keyboard, the audio bus, the diagnostics and the frame loop — installs the
// debugging and automation surface on `window.__coil`, and starts the loop.
//
// Nothing here decides a rule of the game. It wires the pieces together and hands
// the loop its canvas.

import { loadAssets } from "./assets";
import { WebAudioBus } from "./audio";
import { COMBO_WINDOW } from "./constants";
import { installDebugApi } from "./debug";
import { Diagnostics } from "./diagnostics";
import { Game } from "./game";
import { Keyboard } from "./input";
import { Runtime } from "./runtime";

function registerDiagnostics(diagnostics: Diagnostics, game: Game): void {
  const cell = (
    value: { col: number; row: number } | null | undefined,
  ): string => (value ? `${value.col}, ${value.row}` : "none");
  diagnostics.register("screen", () => game.screen);
  diagnostics.register("score", () => String(game.sim.score));
  diagnostics.register("best", () => String(game.best));
  diagnostics.register("combo", () => `x${game.sim.combo}`);
  diagnostics.register(
    "window",
    () => `${game.sim.comboWindow.toFixed(2)} / ${COMBO_WINDOW.toFixed(2)} s`,
  );
  diagnostics.register("dir", () => game.sim.dir);
  diagnostics.register("length", () => String(game.sim.snake.length));
  diagnostics.register("head", () => cell(game.sim.snake[0]));
  diagnostics.register("pellet", () => cell(game.sim.pellet));
}

async function main(): Promise<void> {
  const canvas = document.getElementById("stage");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Coil: the page carries no canvas to draw on");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Coil: a 2D canvas context is unavailable");

  const assets = await loadAssets();
  const audio = new WebAudioBus();
  const game = new Game(audio);
  const keyboard = new Keyboard();
  const diagnostics = new Diagnostics();
  registerDiagnostics(diagnostics, game);

  keyboard.onFirstPress(() => audio.unlock());
  keyboard.attach();

  const runtime = new Runtime({
    canvas,
    ctx,
    game,
    assets,
    keyboard,
    diagnostics,
  });
  installDebugApi(game, runtime);
  runtime.start();

  // Decoding is independent of the first frame: the game is playable and silent
  // until the clips are ready, and a clip that never arrives leaves it that way.
  void audio.load(assets);
}

void main();
