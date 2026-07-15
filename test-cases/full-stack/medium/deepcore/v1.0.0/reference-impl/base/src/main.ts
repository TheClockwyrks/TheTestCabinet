// Deepcore — bootstrap and the fixed-timestep loop (specs/controls.md, specs/overview.md).
//
// Loads the produced assets, fits the fixed 1280×720 stage into the window (letterboxed,
// centered, crisp at any pixel density and on load before any input), wires input, and
// runs the loop: the simulation advances in fixed TICK_DT ticks (in-mine only; frozen on
// menus / pause) decoupled from rendering, which draws every frame and samples the latest
// state. A dev API is published on window.__deepcore so the Playwright proof harness can
// fast-forward setup (fund Credits, grant gear, teleport, give materials, spawn the Core
// Sample, start an expedition) while driving the REAL systems (specs/proof.md).

import { STAGE_HEIGHT, STAGE_WIDTH, TICK_DT } from "./constants";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import type { LoopCue } from "./audio";
import { Bursts } from "./particles";
import { Game } from "./game";
import { Input } from "./input";
import { menuItems, render } from "./render";
import type { Clickable, View } from "./render";
import { buyFuel, buyRepair, buyUpgrade, sellCargo } from "./economy";
import { fabricate } from "./rocket";
import type { OpenPanel, UpgradeTrack } from "./types";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Deepcore: 2D canvas context unavailable");

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
  const cssW = Math.max(1, Math.round(STAGE_WIDTH * scale));
  const cssH = Math.max(1, Math.round(STAGE_HEIGHT * scale));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}
window.addEventListener("resize", resize);
resize();

const LOOP_CUES: LoopCue[] = ["drill", "thrust", "alarm-fuel", "alarm-core"];
const NO_INPUT = { left: false, right: false, down: false, thrust: false };

async function main(): Promise<void> {
  const assets = await loadAssets();
  const audio = new Audio(assets.audioUrls);
  const bursts = new Bursts(assets.fx);
  const game = new Game();
  const input = new Input();
  input.attach(canvas);

  let menuIndex = 0;
  let clickables: Clickable[] = [];
  let elapsed = 0;
  let gestured = false;

  const gesture = (): void => {
    if (!gestured) gestured = true;
    void audio.resume();
  };

  function openPauseMenu(): void {
    if (game.phase !== "in-mine") return;
    if (game.panel) {
      game.closePanel();
      return;
    }
    game.phase = "paused";
    menuIndex = 0;
  }

  function activate(action: string): void {
    if (action.startsWith("nav:")) {
      const dest = action.slice(4);
      game.phase = dest === "mode-select" ? "mode-select" : dest === "how-to" ? "how-to-play" : "title";
      menuIndex = 0;
      return;
    }
    if (action.startsWith("mode:")) {
      game.newExpedition(action.slice(5) === "hardcore" ? "hardcore" : "standard");
      menuIndex = 0;
      return;
    }
    if (action.startsWith("open:")) {
      game.openPanel(action.slice(5) as Exclude<OpenPanel, null>);
      return;
    }
    if (action.startsWith("buy:")) {
      buyUpgrade(game, action.slice(4) as UpgradeTrack);
      return;
    }
    if (action.startsWith("buyfuel:")) {
      const arg = action.slice(8);
      buyFuel(game, arg === "full" ? Infinity : Number(arg));
      return;
    }
    if (action.startsWith("buyrepair:")) {
      const arg = action.slice(10);
      buyRepair(game, arg === "full" ? Infinity : Number(arg));
      return;
    }
    switch (action) {
      case "again":
      case "restart":
        game.newExpedition(game.mode);
        menuIndex = 0;
        break;
      case "resume":
        game.phase = "in-mine";
        break;
      case "sys:pause":
        openPauseMenu();
        break;
      case "sys:mute":
        audio.toggleMute();
        break;
      case "panel:close":
        game.closePanel();
        break;
      case "sell":
        sellCargo(game);
        break;
      case "fabricate":
        fabricate(game);
        break;
      case "launch":
        game.startLaunch();
        break;
    }
  }

  function routeClick(x: number, y: number): void {
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        activate(c.action);
        return;
      }
    }
  }

  function routeKey(k: string): void {
    const lower = k.toLowerCase();
    if (lower === "m") {
      audio.toggleMute();
      return;
    }
    if (game.phase === "in-mine") {
      if (k === "Escape") {
        openPauseMenu();
      } else if (lower === "e" || k === "Enter") {
        if (!game.panel) game.activateNearbyBuilding();
      } else if (lower === "q") {
        // Jettison ore to lighten an overloaded load (specs/character.md, specs/controls.md).
        game.jettison();
      }
      return;
    }
    // Menu / overlay states — keyboard navigation.
    const items = menuItems(game);
    if (k === "ArrowUp" || lower === "w") menuIndex = (menuIndex - 1 + items.length) % items.length;
    else if (k === "ArrowDown" || lower === "s") menuIndex = (menuIndex + 1) % items.length;
    else if (k === "Enter" || k === " ") {
      if (items[menuIndex]) activate(items[menuIndex]!.action);
    } else if (k === "Escape") {
      if (game.phase === "mode-select" || game.phase === "how-to-play") activate("nav:title");
      else if (game.phase === "paused") activate("resume");
      else if (game.phase === "victory" || game.phase === "game-over") activate("nav:title");
    }
  }

  function syncMenuIndexToPointer(pointer: { x: number; y: number }): void {
    if (game.phase === "in-mine") return;
    const items = menuItems(game);
    for (let idx = 0; idx < items.length; idx++) {
      const c = clickables.find((cl) => cl.action === items[idx]!.action);
      if (c && pointer.x >= c.x && pointer.x <= c.x + c.w && pointer.y >= c.y && pointer.y <= c.y + c.h) {
        menuIndex = idx;
        return;
      }
    }
  }

  // ---- Publish the dev API for the proof-capture harness (specs/proof.md) ----
  (window as unknown as { __deepcore?: unknown }).__deepcore = {
    game,
    audio,
    grantCredits: (n: number) => game.grantCredits(n),
    grantGear: (t: number | Record<string, number>) => game.grantGear(t as never),
    teleport: (col: number, row: number) => game.teleport(col, row),
    giveMaterial: (kind: "resonite" | "cryenite" | "core-sample") => game.giveMaterial(kind),
    spawnCoreSample: () => game.spawnCoreSample(),
    setMode: (m: "standard" | "hardcore") => game.setMode(m),
    startExpedition: (m: "standard" | "hardcore") => game.startExpedition(m),
    sell: () => sellCargo(game),
    buyUpgrade: (t: UpgradeTrack) => buyUpgrade(game, t),
    buyFuel: (n: number) => buyFuel(game, n),
    buyRepair: (n: number) => buyRepair(game, n),
    fabricate: () => fabricate(game),
    launch: () => game.startLaunch(),
    openPanel: (p: Exclude<OpenPanel, null>) => game.openPanel(p),
    closePanel: () => game.closePanel(),
  };

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    elapsed += dt;

    const rect = canvas.getBoundingClientRect();
    input.setViewport(rect.width / STAGE_WIDTH, rect.left, rect.top);
    const pointer = input.pointerLogical;

    // Route this frame's input.
    if (input.clicks.length || input.keys.length) gesture();
    for (const c of input.clicks) routeClick(c.x, c.y);
    for (const k of input.keys) routeKey(k);
    input.drain();

    const items = menuItems(game);
    if (menuIndex >= items.length) menuIndex = Math.max(0, items.length - 1);
    syncMenuIndexToPointer(pointer);

    // Advance the simulation (in-mine only; menus/pause are frozen).
    if (game.phase === "in-mine") {
      game.input = input.held();
      acc += dt;
      let steps = 0;
      while (acc >= TICK_DT && steps < 300) {
        game.fixedStep(TICK_DT);
        acc -= TICK_DT;
        steps++;
        if (game.phase !== "in-mine") break; // launch/victory transition mid-batch
      }
    } else {
      game.input = NO_INPUT;
      acc = 0;
    }

    // Drain audio cues + particle bursts produced by the sim.
    for (const cue of game.sndQueue) audio.play(cue);
    game.sndQueue.length = 0;
    for (const fx of game.fxQueue) bursts.spawn(fx);
    game.fxQueue.length = 0;
    bursts.update(dt);
    for (const c of LOOP_CUES) audio.setLoop(c, game.phase === "in-mine" && game.activeLoops.has(c));
    audio.syncLoops();

    const view: View = { time: elapsed, menuIndex, muted: audio.muted, pointer };
    const sx = canvas.width / STAGE_WIDTH;
    const sy = canvas.height / STAGE_HEIGHT;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    clickables = render(ctx!, game, assets, bursts, view);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
