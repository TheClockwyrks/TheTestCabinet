// Arc Foundry — bootstrap and the fixed-timestep loop (specs/controls.md, specs/overview.md).
//
// Loads the produced assets, fits the fixed 1280×720 stage into the window (letterboxed,
// centered, crisp at any pixel density and on load before any input), wires input, and
// runs the loop: the simulation advances in fixed FIXED_STEP ticks (scaled by the 1×/2×
// speed control, frozen while paused) decoupled from rendering, which interpolates and
// draws every frame. This is the wiring layer; the simulation (sim.ts) and renderer
// (render.ts) are the stubs the core / presentation implementers fill in.

import { DIFFICULTY, FIXED_STEP, PANEL_X, STAGE_H, STAGE_W, STATUS_H, mapById } from "./constants";
import { CAMPAIGN } from "./mode";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { Bursts } from "./particles";
import { Game } from "./sim";
import { Input } from "./input";
import { menuItems } from "./menus";
import { render, setMenuIndex, setMuted, setRenderTime } from "./render";
import type { Clickable, ComboType, ComponentType, Difficulty, MapDef, Tier } from "./types";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Arc Foundry: 2D canvas context unavailable");

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
  const game = new Game(CAMPAIGN);
  const input = new Input();
  input.attach(canvas);

  let menuIndex = 0;
  let clickables: Clickable[] = [];
  let gestured = false;
  let elapsed = 0;
  // The Salvage flow picks a map, THEN a difficulty, before a run starts (specs/modes.md).
  let pendingMap: MapDef | null = null;

  // A fresh 32-bit seed for the scrap-press, so each interactive run rolls a DIFFERENT
  // component sequence (specs/build.md). Headless / dev drivers keep the fixed default.
  const randomSeed = (): number => Math.floor(Math.random() * 0x100000000) >>> 0;

  // Expose the live game for headless / dev driving (inert during normal play).
  (window as unknown as { __arcfoundry?: unknown }).__arcfoundry = {
    game,
    audio,
    startOn: (mapId: string, diffKey: Difficulty) => game.startOn(mapById(mapId), DIFFICULTY[diffKey]),
    // Drop a rock at a 2×2 anchor (rolls a candidate on placement), for scripted layouts.
    placeStamp: (col: number, row: number) => game.placeStamp(col, row),
    // Place an EXACT type + quality COMPONENT at a named anchor (no roll / no cost) — the
    // deterministic board-layout path a headless driver uses (specs/build.md).
    place: (type: ComponentType, tier: Tier, col: number, row: number) => game.devPlace(type, tier, col, row),
    // Drop an inert BLOCKER at a named anchor (no roll / no cost) — for scripted mazes.
    blocker: (col: number, row: number) => game.devBlocker(col, row),
    keep: (id: number) => game.keep(id),
    combine: (id: number) => game.combine(id),
    // Assemble a candidate into a COMBINATION TOWER by recipe (deterministic driver path).
    combineRecipe: (id: number, combo: ComboType) => game.combineRecipe(id, combo),
    reachableCombos: (id: number) => game.reachableCombosFor(id),
    remove: (id: number) => game.removeStructure(id),
    upgradeQuality: () => game.upgradeQuality(),
    setRefinement: (r: 0 | 1 | 2 | 3 | 4 | 5) => game.devSetRefinement(r),
    startWave: () => game.startWave(),
    pull: () => game.pullPress(),
    setState: (s: Game["state"]) => (game.state = s),
  };

  const gesture = (): void => {
    if (!gestured) gestured = true;
    void audio.resume();
  };

  function activate(action: string, payload?: string): void {
    if (action.startsWith("map:")) {
      // A map-select choice — remember it and advance to the difficulty select.
      pendingMap = mapById(action.slice(4));
      game.state = "difficultyselect";
      menuIndex = 0;
      return;
    }
    if (action.startsWith("diff:")) {
      // A difficulty choice — start the campaign on the chosen map + difficulty.
      const d = action.slice(5) as Difficulty;
      game.startOn(pendingMap ?? game.map, DIFFICULTY[d]);
      game.reseedPress(randomSeed()); // fresh press roll sequence for this run
      menuIndex = 0;
      return;
    }
    switch (action) {
      case "menu:play":
        game.state = "mapselect";
        menuIndex = 0;
        break;
      case "menu:restart":
      case "menu:again":
        // Replay the same campaign on the same chosen map + difficulty (specs/flow.md).
        game.startOn(game.map, game.diff);
        game.reseedPress(randomSeed()); // a fresh roll sequence on the replay too
        menuIndex = 0;
        break;
      case "menu:howto":
        game.state = "howto";
        menuIndex = 0;
        break;
      case "menu:back":
        // Back out one screen: difficulty → map, otherwise → title.
        game.state = game.state === "difficultyselect" ? "mapselect" : "title";
        menuIndex = 0;
        break;
      case "menu:quit":
      case "menu:menu":
        game.state = "title";
        menuIndex = 0;
        break;
      case "menu:resume":
        game.state = "playing";
        game.paused = false; // Resume fully un-freezes (clears any interactive pause too)
        break;
      case "stamp":
        // Pull the scrap-press (specs/build.md) — arms a blank rock; it rolls on placement.
        game.pullPress();
        break;
      case "keep":
        game.keepSelected();
        break;
      case "combine":
        game.combineSelected();
        break;
      case "comborecipe":
        // Assemble the selected candidate into the chosen COMBINATION TOWER (specs/build.md).
        if (payload) game.combineRecipeSelected(payload as ComboType);
        break;
      case "upgrade":
        game.upgradeQuality();
        break;
      case "targeting":
        game.cycleTargetingSelected();
        break;
      case "remove":
        // Dismantle the selected structure (build phase only) — a misplacement correction.
        game.removeSelected();
        break;
      case "startWave":
        game.startWave();
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
      // Outside play, only navigation clicks fire (menu items and map/difficulty cards).
      if (game.state !== "playing" && !c.action.startsWith("menu:") && !c.action.startsWith("map:") && !c.action.startsWith("diff:")) continue;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        activate(c.action, c.payload);
        return;
      }
    }
    // Board hit-test while playing: drop the held rock at the snapped 2×2 anchor (the roll
    // happens on the drop, and the press re-arms for continuous placement), or select /
    // deselect the structure under the pointer (specs/board.md, specs/controls.md).
    if (game.state === "playing" && x < PANEL_X && y > STATUS_H) {
      if (game.holding) {
        const a = game.board.pixelToAnchor(x, y);
        game.placeStamp(a.col, a.row);
      } else {
        game.selectAt(x, y);
      }
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
        // In the build phase, Space starts / sends the wave; once a wave is live it toggles
        // the interactive (in-place) pause (specs/controls.md).
        if (game.phase === "build") game.startWave();
        else game.togglePause();
        return;
      }
      if (lower === "b") {
        game.pullPress();
        return;
      }
      if (lower === "k") {
        game.keepSelected();
        return;
      }
      if (lower === "c") {
        game.combineSelected();
        return;
      }
      if (lower === "g") {
        // Assemble the selected candidate into its first reachable COMBINATION TOWER (a quick
        // keyboard commit; the inspector lists every reachable combo for a precise pick).
        if (game.selectedId != null) {
          const opts = game.reachableCombosFor(game.selectedId);
          if (opts[0]) game.combineRecipeSelected(opts[0].combo);
        }
        return;
      }
      if (lower === "u") {
        game.upgradeQuality();
        return;
      }
      if (lower === "t") {
        game.cycleTargetingSelected();
        return;
      }
      if (lower === "x" || k === "Delete" || k === "Backspace") {
        // Dismantle the selected structure (build phase only), for a misplacement.
        game.removeSelected();
        return;
      }
      if (lower === "f") {
        game.cycleSpeed();
        return;
      }
      if (k === "Escape") {
        // Esc first cancels a held rock / selection; otherwise it opens the pause MENU.
        if (game.holding) game.cancelHeld();
        else if (game.selectedId != null) game.select(null);
        else openPauseMenu();
      }
      return;
    }
    // Menu states. Up/Left (or W/A) and Down/Right (or S/D) move the selection — the
    // map / difficulty cards lay out horizontally, so left/right feel natural there too.
    const items = menuItems(game.state, game);
    if (k === "ArrowUp" || k === "ArrowLeft" || lower === "w" || lower === "a") menuIndex = (menuIndex - 1 + items.length) % items.length;
    else if (k === "ArrowDown" || k === "ArrowRight" || lower === "s" || lower === "d") menuIndex = (menuIndex + 1) % items.length;
    else if (k === "Enter" || k === " ") {
      if (items[menuIndex]) activate(items[menuIndex]!.action);
    } else if (k === "Escape") {
      if (game.state === "howto" || game.state === "mapselect") activate("menu:back");
      else if (game.state === "difficultyselect") activate("menu:back");
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
    if (input.rightClicks > 0 && game.holding) game.cancelHeld();
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
