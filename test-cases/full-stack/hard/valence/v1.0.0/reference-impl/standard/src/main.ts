// Valence — bootstrap and the fixed-timestep loop (specs/controls.md, specs/overview.md).
//
// Loads the produced assets, fits the fixed 1280x720 stage into the window
// (letterboxed, centered, crisp at any pixel density and on load before any input),
// wires input, and runs the loop: the simulation advances in fixed FIXED_STEP ticks
// (scaled by the speed control, frozen while paused) decoupled from rendering, which
// interpolates and draws every frame.

import { FIXED_STEP, PANEL_X, STAGE_H, STAGE_W, STATUS_H, TOWER_ORDER, type TowerKind } from "./constants";
import { NODES } from "./board";
import { MODE } from "./mode";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { Bursts } from "./particles";
import { Game } from "./sim";
import { Input } from "./input";
import { menuItems } from "./menus";
import { render, setMenuIndex, setMuted, setRenderTime } from "./render";
import type { Clickable } from "./types";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Valence: 2D canvas context unavailable");

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

async function main(): Promise<void> {
  const assets = await loadAssets();
  const audio = new Audio(assets.audioUrl);
  const bursts = new Bursts(assets.fx);
  const game = new Game(MODE);
  const input = new Input();
  input.attach(canvas);

  let menuIndex = 0;
  let clickables: Clickable[] = [];
  let gestured = false;
  let elapsed = 0;

  // Expose the live game for the Playwright proof-capture script (inert in play).
  (window as unknown as { __valence?: unknown }).__valence = {
    game,
    audio,
    build: (kind: TowerKind, node: number) => {
      game.selectShop(kind);
      game.clickNode(node);
      game.cancelBuild();
    },
    setState: (s: Game["state"]) => (game.state = s),
  };

  const gesture = (): void => {
    if (!gestured) gestured = true;
    void audio.resume();
  };

  function activate(action: string): void {
    if (action.startsWith("shop:")) {
      game.selectShop(action.slice(5) as TowerKind);
      return;
    }
    switch (action) {
      case "menu:play":
      case "menu:restart":
      case "menu:again":
        game.start();
        menuIndex = 0;
        break;
      case "menu:howto":
        game.state = "howto";
        menuIndex = 0;
        break;
      case "menu:back":
      case "menu:quit":
      case "menu:menu":
        game.state = "title";
        menuIndex = 0;
        break;
      case "menu:resume":
        game.state = "playing";
        break;
      case "upgrade":
        game.upgradeSelected();
        break;
      case "sell":
        game.sellSelected();
        break;
      case "startRound":
        game.startRound();
        break;
      case "speed":
        game.cycleSpeed();
        break;
      case "pause":
        togglePause();
        break;
      case "mute":
        audio.toggleMute();
        break;
    }
  }

  function togglePause(): void {
    if (game.state === "playing") game.state = "paused";
    else if (game.state === "paused") game.state = "playing";
  }

  function routeClick(x: number, y: number): void {
    // Topmost clickable first (later-pushed regions draw on top).
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      if (game.state !== "playing" && !c.action.startsWith("menu:")) continue;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        activate(c.action);
        return;
      }
    }
    // Board hit-test (placement / selection) only while playing.
    if (game.state === "playing" && x < PANEL_X && y > STATUS_H) {
      let hit: number | null = null;
      let best = 24 * 24;
      for (const n of NODES) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < best) {
          best = d;
          hit = n.id;
        }
      }
      if (hit != null) game.clickNode(hit);
      else game.clickEmptyBoard();
    }
  }

  function routeKey(k: string): void {
    const lower = k.toLowerCase();
    if (lower === "m") {
      audio.toggleMute();
      return;
    }
    if (game.state === "playing") {
      if (k === " ") {
        if (game.phase === "build") game.startRound();
        return;
      }
      if (k >= "1" && k <= "5") {
        game.selectShop(TOWER_ORDER[Number(k) - 1]!);
        return;
      }
      if (lower === "f" || k === "+" || k === "=" || k === "-") {
        game.cycleSpeed();
        return;
      }
      if (lower === "u") {
        game.upgradeSelected();
        return;
      }
      if (lower === "s") {
        game.sellSelected();
        return;
      }
      if (k === "Escape") {
        if (game.buildKind) game.cancelBuild();
        else if (game.selectedNode != null) game.clickEmptyBoard();
        else togglePause();
      }
      return;
    }
    // Menu states.
    const items = menuItems(game.state, game);
    if (k === "ArrowUp" || lower === "w") menuIndex = (menuIndex - 1 + items.length) % items.length;
    else if (k === "ArrowDown" || lower === "s") menuIndex = (menuIndex + 1) % items.length;
    else if (k === "Enter" || k === " ") {
      if (items[menuIndex]) activate(items[menuIndex]!.action);
    } else if (k === "Escape") {
      if (game.state === "howto") activate("menu:back");
      else if (game.state === "paused") activate("menu:resume");
      else if (game.state === "victory" || game.state === "defeat") activate("menu:menu");
    }
  }

  function syncMenuIndexToPointer(): void {
    if (game.state === "playing") return;
    const items = menuItems(game.state, game);
    for (let idx = 0; idx < items.length; idx++) {
      const c = clickables.find((cl) => cl.action === items[idx]!.action);
      if (c && game.pointerX >= c.x && game.pointerX <= c.x + c.w && game.pointerY >= c.y && game.pointerY <= c.y + c.h) {
        menuIndex = idx;
        return;
      }
    }
  }

  function handleInput(): void {
    if (input.clicks.length || input.keys.length || input.rightClicks) gesture();
    for (const c of input.clicks) routeClick(c.x, c.y);
    if (input.rightClicks > 0 && game.buildKind) game.cancelBuild();
    for (const k of input.keys) routeKey(k);
    input.drain();
  }

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    elapsed += dt;

    // Map the pointer into logical space with the live fit transform.
    const rect = canvas.getBoundingClientRect();
    input.setViewport(rect.width / STAGE_W, rect.left, rect.top);
    const pl = input.pointerLogical;
    game.pointerX = pl.x;
    game.pointerY = pl.y;

    handleInput();
    syncMenuIndexToPointer();

    if (game.state === "playing") {
      acc += dt * game.speed;
      let steps = 0;
      while (acc >= FIXED_STEP && steps < 600) {
        game.fixedStep(FIXED_STEP);
        acc -= FIXED_STEP;
        steps++;
      }
    } else {
      acc = 0;
    }

    for (const cue of game.sndQueue) audio.play(cue);
    game.sndQueue.length = 0;
    for (const fx of game.fxQueue) bursts.spawn(fx);
    game.fxQueue.length = 0;
    bursts.update(dt);

    setRenderTime(elapsed);
    setMuted(audio.muted);
    setMenuIndex(menuIndex);

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    clickables = render(ctx!, game, assets, bursts);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
