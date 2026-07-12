// Valence — bootstrap and the fixed-timestep loop (specs/controls.md, specs/overview.md).
//
// Loads the produced assets, fits the fixed 1280x720 stage into the window
// (letterboxed, centered, crisp at any pixel density and on load before any input),
// wires input, and runs the loop: the simulation advances in fixed FIXED_STEP ticks
// (scaled by the speed control, frozen while paused) decoupled from rendering, which
// interpolates and draws every frame.

import { FIXED_STEP, PANEL_X, STAGE_H, STAGE_W, STATUS_H, TOWER_ORDER, type TowerKind } from "./constants";
import { mapById } from "./board";
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
  // Placement is free: helpers take world coordinates directly (specs/board.md).
  (window as unknown as { __valence?: unknown }).__valence = {
    game,
    audio,
    startOn: (id: string) => game.startOn(mapById(id)),
    // The tower nearest a world point (placement snaps away from the exact anchor).
    nearestTower: (x: number, y: number) => {
      let best = null as null | { x: number; y: number; id: number };
      let bd = Infinity;
      for (const t of game.towers) {
        const d = Math.hypot(t.x - x, t.y - y);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      return best;
    },
    // Place a tower at a free board position, snapping to the nearest legal spot.
    build: (kind: TowerKind, x: number, y: number) => {
      game.placeNear(x, y, kind);
    },
    select: (x: number, y: number) => {
      const t = game.towerAt(x, y);
      game.selectedTowerId = t ? t.id : null;
    },
    // Upgrade the tower nearest (x, y) toward `level`, taking `branch` for the tier-III step.
    upgrade: (x: number, y: number, level = 3, branch: "A" | "B" = "A") => {
      let t = null as (typeof game.towers)[number] | null;
      let bd = Infinity;
      for (const o of game.towers) {
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < bd) {
          bd = d;
          t = o;
        }
      }
      if (!t || bd > 60) return;
      while (t.level < level) {
        const ok = game.upgrade(t, t.level === 2 ? branch : undefined);
        if (!ok) break;
      }
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
    if (action.startsWith("map:")) {
      // A map-select choice — start the campaign on that map (specs/board.md, flow.md).
      game.startOn(mapById(action.slice(4)));
      menuIndex = 0;
      return;
    }
    switch (action) {
      case "menu:play":
        // The campaign start opens the map select (specs/flow.md).
        game.state = "mapselect";
        menuIndex = 0;
        break;
      case "menu:restart":
      case "menu:again":
        // Replay the same campaign on the same chosen map (specs/flow.md).
        game.startOn(game.map);
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
        game.paused = false; // Resume fully un-freezes (clears any interactive pause too)
        break;
      case "upgrade":
        game.upgradeSelected();
        break;
      case "branchA":
        game.upgradeSelected("A");
        break;
      case "branchB":
        game.upgradeSelected("B");
        break;
      case "sell":
        game.sellSelected();
        break;
      case "targeting":
        // Cycle the selected damage tower's targeting priority (specs/controls.md).
        game.cycleTargetingSelected();
        break;
      case "startRound":
        game.startRound();
        break;
      case "speed":
        game.cycleSpeed();
        break;
      case "pause":
        // The status-bar control pauses / resumes IN PLACE (no menu) — specs/controls.md.
        game.togglePause();
        break;
      case "mute":
        audio.toggleMute();
        break;
    }
  }

  // Open the Esc overlay menu, which also freezes the board (specs/flow.md).
  function openPauseMenu(): void {
    if (game.state !== "playing") return;
    game.state = "paused";
    menuIndex = 0;
  }

  function routeClick(x: number, y: number): void {
    // Topmost clickable first (later-pushed regions draw on top).
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      // Outside play, only navigation clicks fire (menu items and map-select cards).
      if (game.state !== "playing" && !c.action.startsWith("menu:") && !c.action.startsWith("map:")) continue;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        activate(c.action);
        return;
      }
    }
    // Board hit-test (free placement / selection) only while playing. A click places the
    // held tower at the pointer, or selects/deselects a tower under it (specs/board.md).
    if (game.state === "playing" && x < PANEL_X && y > STATUS_H) {
      game.clickBoard(x, y);
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
        // In the build phase, Space launches the round; once a round is live it toggles
        // the interactive (in-place) pause so you can keep building on a still board
        // without opening the menu (specs/controls.md).
        if (game.phase === "build") game.startRound();
        else game.togglePause();
        return;
      }
      if (k >= "1" && k <= "7") {
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
      if (lower === "t") {
        // Cycle the selected damage tower's targeting priority (specs/controls.md).
        game.cycleTargetingSelected();
        return;
      }
      if (k === "Escape") {
        // Esc first cancels a held tool / selection; otherwise it opens the pause MENU
        // (which also freezes the board), even if already interactively paused.
        if (game.buildKind) game.cancelBuild();
        else if (game.selectedTowerId != null) game.clickEmptyBoard();
        else openPauseMenu();
      }
      return;
    }
    // Menu states. Up/Left (or W/A) and Down/Right (or S/D) move the selection — the
    // map-select cards lay out horizontally, so left/right feel natural there too.
    const items = menuItems(game.state, game);
    if (k === "ArrowUp" || k === "ArrowLeft" || lower === "w" || lower === "a") menuIndex = (menuIndex - 1 + items.length) % items.length;
    else if (k === "ArrowDown" || k === "ArrowRight" || lower === "s" || lower === "d") menuIndex = (menuIndex + 1) % items.length;
    else if (k === "Enter" || k === " ") {
      if (items[menuIndex]) activate(items[menuIndex]!.action);
    } else if (k === "Escape") {
      if (game.state === "howto" || game.state === "mapselect") activate("menu:back");
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

    if (game.state === "playing" && !game.paused) {
      acc += dt * game.speed;
      let steps = 0;
      while (acc >= FIXED_STEP && steps < 600) {
        game.fixedStep(FIXED_STEP);
        acc -= FIXED_STEP;
        steps++;
      }
    } else {
      // Frozen — by the interactive pause, the Esc menu, or a non-play screen. Drop the
      // accumulator so no burst of ticks fires on resume.
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
