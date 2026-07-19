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
import { installDebugApi, drawDebugOverlay } from "./debug";
import { Game } from "./sim";
import { Input } from "./input";
import { menuItems } from "./menus";
import { render, setMenuIndex, setMuted, setOverlays, setRenderTime } from "./render";
import type { Clickable, ComboType, Difficulty, MapDef } from "./types";

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
  // View-only HUD overlays toggled from the top bar / keyboard (specs/controls.md): the COMBOS
  // recipe book and the live tower DAMAGE BOARD. Kept here (not in the sim) — they never touch
  // the deterministic game state.
  let showCombos = false;
  let showBoard = false;
  // The read-only debug overlay (specs/instrumentation.md), toggled with the backtick key.
  // Off by default; a diagnostic layer that never touches gameplay.
  let showDebug = false;
  // The Salvage flow picks a map, THEN a difficulty, before a run starts (specs/modes.md).
  let pendingMap: MapDef | null = null;

  // The MANUAL CLOCK (specs/instrumentation.md). autoStep is on by default for normal play:
  // the animation-frame loop advances the tick from the wall clock. The debug API turns it off
  // (reset / step) to drive the sim by exact steps, and back on (setAutoStep) for a live clip.
  // Held in a small object so the debug surface can read and write it by reference.
  const clock = { autoStep: true };

  // A fresh 32-bit seed for the scrap-press, so each interactive run rolls a DIFFERENT
  // component sequence (specs/build.md). Headless / dev drivers keep the fixed default.
  const randomSeed = (): number => Math.floor(Math.random() * 0x100000000) >>> 0;

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
        // KEEP the selected candidate — the level's harvest, which immediately LAUNCHES the wave
        // (there is no SEND; every level must harvest to advance — specs/build.md, specs/flow.md).
        game.keepSelected();
        break;
      case "merge":
        // Fold the selected fresh candidate INTO a matching standing tower, landing the result at
        // the existing tower's footprint (specs/build.md). A fresh-consuming combine, so it also
        // launches the wave.
        game.mergeSelectedInto();
        break;
      case "combine":
        // Combine the current selection NOW (quality pair or recipe; explicit multi-select or
        // auto-resolved) — immediate, build phase OR live wave (specs/build.md, specs/controls.md).
        game.combineSelected();
        break;
      case "comborecipe":
        // Assemble the selected structure into the chosen COMBINATION TOWER, now (specs/build.md).
        if (payload) game.combineRecipeSelected(payload as ComboType);
        break;
      case "upgrade":
        game.upgradeQuality();
        break;
      case "comboupgrade":
        // Spend Charge to raise the selected combination tower's upgrade level (specs/towers.md).
        game.upgradeComboSelected();
        break;
      case "downgrade":
        // KEEP the selected CANDIDATE one quality tier lower (build phase, free) — the harvest, so
        // it launches the wave; fold the lowered tower into a recipe mid-wave (specs/build.md).
        game.downgradeSelected();
        break;
      case "targeting":
        game.cycleTargetingSelected();
        break;
      case "remove":
        // Dismantle the selected structure (build phase only) — a misplacement correction.
        game.removeSelected();
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
      case "toggleCombos":
        showCombos = !showCombos;
        break;
      case "toggleLeaderboard":
        showBoard = !showBoard;
        break;
      case "noop":
        // A click swallowed by an open overlay's backdrop — intentionally does nothing.
        break;
    }
  }

  // Open the Esc overlay menu, which also freezes the board (specs/flow.md).
  function openPauseMenu(): void {
    if (game.state !== "playing") return;
    game.state = "paused";
    menuIndex = 0;
  }

  function routeClick(x: number, y: number, shift: boolean): void {
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
    // deselect the structure under the pointer — SHIFT-click adds to the multi-select combine
    // set (specs/board.md, specs/controls.md, specs/build.md).
    if (game.state === "playing" && x < PANEL_X && y > STATUS_H) {
      if (game.holding) {
        const a = game.board.pixelToAnchor(x, y);
        game.placeStamp(a.col, a.row);
      } else {
        game.selectAt(x, y, shift);
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
        // There is no SEND — a wave launches when you commit the level's harvest (K / C), not on
        // Space (specs/build.md, specs/flow.md). Space only toggles the interactive (in-place)
        // pause while a wave is live; in the build phase it does nothing.
        if (game.phase === "wave") game.togglePause();
        return;
      }
      if (lower === "b") {
        game.pullPress();
        return;
      }
      if (lower === "k") {
        // KEEP the selected candidate — the harvest, which LAUNCHES the wave (specs/build.md).
        game.keepSelected();
        return;
      }
      if (lower === "e") {
        // MERGE the selected fresh candidate INTO a matching standing tower (result lands at the
        // existing tower); a fresh-consuming combine, so it launches the wave (specs/build.md).
        game.mergeSelectedInto();
        return;
      }
      if (lower === "c") {
        // Combine the current selection now — quality pair or recipe, explicit or auto-resolved
        // (specs/controls.md). Works in the build phase AND during a live wave.
        game.combineSelected();
        return;
      }
      if (lower === "g") {
        // KEEP the selected CANDIDATE one quality tier lower (build phase, free) — the harvest, so
        // it sends the wave; fold the lowered tower into a recipe mid-wave (specs/build.md).
        game.downgradeSelected();
        return;
      }
      if (lower === "u") {
        // Contextual UPGRADE: a selected combination tower upgrades ITSELF (spends Charge to
        // raise its level); otherwise UPGRADE QUALITY refines the press (specs/build.md,
        // specs/towers.md).
        const sel = game.selected();
        if (sel && sel.kind === "component" && sel.combo) game.upgradeComboSelected();
        else game.upgradeQuality();
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
      if (lower === "v") {
        // Toggle the COMBINATIONS recipe book overlay (specs/controls.md).
        showCombos = !showCombos;
        return;
      }
      if (lower === "l") {
        // Toggle the live tower DAMAGE BOARD overlay (specs/controls.md).
        showBoard = !showBoard;
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
    for (const c of input.clicks) routeClick(c.x, c.y, c.shift);
    if (input.rightClicks > 0 && game.holding) game.cancelHeld();
    for (const k of input.keys) {
      // The backtick toggles the read-only debug overlay in ANY state (specs/instrumentation.md);
      // it is a diagnostic layer, not a game control, so it bypasses the gameplay routing.
      if (k === "`") {
        showDebug = !showDebug;
        continue;
      }
      routeKey(k);
    }
    input.drain();
    // Mirror the view-only flags onto the game so snapshot() / the debug overlay report them
    // (specs/instrumentation.md). These never feed back into the simulation.
    game.muted = audio.muted;
    game.uiCombos = showCombos;
    game.uiBoard = showBoard;
  }

  // Install the debugging and automation API on window.__foundry (specs/instrumentation.md).
  // It routes through the very systems normal play uses: the real game, the manual clock, the
  // input handlers above, and the run/pointer helpers. Inert until something calls it.
  installDebugApi({
    game,
    clock,
    processInput: handleInput,
    routeClickAt: (x, y, shift) => routeClick(x, y, shift),
    cancelHeld: () => {
      if (game.holding) game.cancelHeld();
    },
    startRun: (mapId, diff) => game.startOn(mapById(mapId), DIFFICULTY[diff]),
    setPointer: (x, y) => {
      game.pointerX = x;
      game.pointerY = y;
    },
    resetUi: () => {
      menuIndex = 0;
      showCombos = false;
      showBoard = false;
      pendingMap = null;
    },
  });

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    elapsed += dt;

    // Map the pointer into logical space with the live fit transform. While the driver holds
    // the manual clock (autoStep off) the real mouse does NOT move the ghost — the debug API's
    // pointerMove owns the pointer — so a driven scenario stays exact (specs/instrumentation.md).
    if (clock.autoStep) {
      const rect = canvas.getBoundingClientRect();
      input.setViewport(rect.width / STAGE_W, rect.left, rect.top);
      const pl = input.pointerLogical;
      game.pointerX = pl.x;
      game.pointerY = pl.y;
    }

    handleInput();
    syncMenuIndexToPointer();

    // Advance the simulation from the wall clock ONLY while autoStep is on (normal play). While
    // it is off, the loop still renders every frame but the sim advances solely through the
    // debug API's step() — so a stepped scenario is exact regardless of machine load.
    if (clock.autoStep && game.state === "playing" && !game.paused) {
      acc += dt * game.speed;
      let steps = 0;
      while (acc >= FIXED_STEP && steps < 600) {
        game.fixedStep(FIXED_STEP);
        acc -= FIXED_STEP;
        steps++;
      }
    } else {
      // Frozen — by the interactive pause, the Esc menu, a non-play screen, or the manual clock.
      // Drop the accumulator so no burst of ticks fires on resume.
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
    setOverlays(showCombos, showBoard);

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    clickables = render(ctx!, game, assets, bursts);
    // The debug overlay draws last, over the finished frame, in the same logical transform.
    if (showDebug) drawDebugOverlay(ctx!, game);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
