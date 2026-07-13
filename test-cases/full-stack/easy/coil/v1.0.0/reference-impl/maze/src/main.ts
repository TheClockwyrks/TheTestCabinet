// Coil — bootstrap, the fixed-timestep loop, and input routing (specs/mechanics.md,
// specs/flow.md).
//
// Loads the produced assets, fits the fixed 1280×720 stage into the window (letterboxed,
// centred, crisp at any device-pixel ratio and correct on load before any input), builds the
// audio / game / input systems, and runs the loop: rendering on every animation frame
// (decoupled from the sim) while the simulation advances in fixed 125 ms ticks only while
// playing. The head-bite animation and the audio cues are driven from the per-tick events the
// game returns. `window.__coil` exposes the live sim and a synchronous `step()` for the
// headless screenshot / verification harness; it is inert during normal play.

import { STAGE_H, STAGE_W, TICK_DT } from "./constants";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { Game } from "./game";
import type { TickEvents } from "./game";
import { Input } from "./input";
import { menuItems } from "./menus";
import { MODE } from "./mode";
import { render, setAssets } from "./render";
import type { Dir } from "./sim";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Coil: 2D canvas context unavailable");

// Fit the fixed stage into the window: letterboxed, centred by the flex body, crisp at any
// device-pixel ratio. Called on load (before any input) and on every resize.
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const cssW = Math.max(1, Math.round(STAGE_W * scale));
  const cssH = Math.max(1, Math.round(STAGE_H * scale));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}
window.addEventListener("resize", resize);
resize();

// Steering keys → direction (arrows and WASD are interchangeable, specs/flow.md).
const STEER: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};

const BITE_FRAME_S = 0.055; // seconds per bite frame (frames 1,2,3 then back to rest)

async function main(): Promise<void> {
  const assets = await loadAssets();
  setAssets(assets);
  const audio = new Audio(assets.audioUrl);
  const game = new Game(MODE);
  const input = new Input();
  input.attach();

  let gestured = false;
  let elapsed = 0;
  let lastEat = -10; // start well before now so no bite plays on load

  // The dev/control surface for the headless capture + verification harness (reference/
  // README.md, specs/proof.md). Inert during normal play; `sim` is a live getter because a
  // new round replaces the Sim instance.
  (window as unknown as { __coil?: unknown }).__coil = {
    get sim() {
      return game.sim;
    },
    state: () => game.state,
    mode: () => game.mode,
    start: () => game.start(),
    step: (n = 1) => game.step(n),
    game,
    audio,
  };

  const gesture = (): void => {
    if (!gestured) gestured = true;
    void audio.resume();
  };

  function activate(action: string): void {
    switch (action) {
      case "start":
        game.start();
        break;
      case "howto":
        game.toHowto();
        break;
      case "menu":
        game.toMenu();
        break;
      case "resume":
        game.resume();
        break;
      case "restart":
        game.restart();
        break;
    }
  }

  function routeMenuKey(key: string): void {
    const lower = key.toLowerCase();
    const items = menuItems(game.state, game);
    if (key === "ArrowUp" || lower === "w") {
      game.menuIndex = (game.menuIndex - 1 + items.length) % items.length;
    } else if (key === "ArrowDown" || lower === "s") {
      game.menuIndex = (game.menuIndex + 1) % items.length;
    } else if (key === "Enter" || key === " ") {
      const item = items[game.menuIndex];
      if (item) activate(item.action);
    } else if (key === "Escape") {
      if (game.state === "howto") game.toMenu();
      else if (game.state === "paused") game.resume();
      else if (game.state === "gameover" || game.state === "cleared") game.toMenu();
    }
  }

  function routeKey(key: string): void {
    if (key === "m" || key === "M") {
      audio.toggleMute();
      return;
    }
    if (game.state === "playing") {
      const dir = STEER[key];
      if (dir) {
        game.requestTurn(dir);
        return;
      }
      if (key === "Escape" || key === "p" || key === "P") game.pause();
      return;
    }
    routeMenuKey(key);
  }

  function applyEvents(ev: TickEvents): void {
    if (ev.ate) {
      audio.play("eat");
      lastEat = elapsed;
    }
    if (ev.comboRose) audio.play("combo");
    if (ev.died) audio.play("death");
  }

  function biteFrame(): number {
    if (game.state !== "playing") return 0;
    const t = elapsed - lastEat;
    if (t < 0) return 0;
    const idx = Math.floor(t / BITE_FRAME_S);
    return idx < 3 ? idx + 1 : 0; // frames 1,2,3 then rest
  }

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    elapsed += dt;

    const keys = input.drain();
    if (keys.length > 0) gesture();
    for (const k of keys) routeKey(k);

    // Fixed-step simulation: advance the sim in whole 125 ms ticks while playing (unless the
    // test harness has taken the clock via step(), which sets auto=false).
    if (game.state === "playing" && game.auto) {
      acc += dt;
      let steps = 0;
      while (acc >= TICK_DT && steps < 10) {
        const ev = game.autoTick();
        if (ev) applyEvents(ev);
        acc -= TICK_DT;
        steps++;
        if (game.state !== "playing") break;
      }
    } else {
      acc = 0;
    }

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    render(ctx!, game, { time: elapsed, biteFrame: biteFrame(), muted: audio.muted });

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
