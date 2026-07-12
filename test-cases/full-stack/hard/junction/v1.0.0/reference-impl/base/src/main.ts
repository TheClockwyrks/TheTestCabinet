// Junction — bootstrap and the fixed-timestep loop (specs/controls.md, specs/overview.md,
// DESIGN §4, §5).
//
// Loads the produced assets, fits the fixed 1280×720 stage into the window (letterboxed,
// centered, crisp at any pixel density and correct on load before any input), wires input,
// and runs the loop: the simulation advances in fixed FIXED_STEP ticks (scaled by the speed
// control, frozen while paused or on a menu) decoupled from rendering, which interpolates and
// draws every frame. Each frame it drains the sim's sound/fx queues into the Web Audio layer
// and the particle players, and exposes the `window.__junction` test hook (the valence
// `__valence` analogue) so the Playwright proof captures drive the real Game.

import { EDGE_MARGIN, FIXED_STEP, PAN_SPEED, STAGE_H, STAGE_W, VIEW_Y0, VIEW_Y1 } from "./constants";
import { MODE } from "./mode";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { Bursts, Haze } from "./particles";
import { Game } from "./sim";
import { Input } from "./input";
import { menuItems } from "./menus";
import { render, setDragAnchor, setMenuIndex, setMuted, setPointer, setRenderTime } from "./render";
import { idx, inBounds } from "./world";
import type { Clickable, Overlay, Tool, ZoneKind } from "./types";

const ZOOM_STEP = 2; // on-screen px per tile added/removed per wheel notch

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Junction: 2D canvas context unavailable");

// Fit the fixed stage into the window, letterboxed + centered, crisp at the device pixel
// ratio. Called before the first frame (and on every resize) so the view is correct on load.
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
  const haze = new Haze(assets.fx.haze);
  const bursts = new Bursts(assets.fx);
  const game = new Game(MODE);
  const input = new Input();
  input.attach(canvas);

  let menuIndex = 0;
  let clickables: Clickable[] = [];
  let gestured = false;
  let elapsed = 0;

  // An in-progress tool drag (zone rectangle / carrier run) — the anchor tile it began on.
  let toolDrag: { tool: Tool; col: number; row: number } | null = null;
  // An in-progress camera drag-pan — the mouse button held and the last pointer position.
  let pan: { button: number; lastX: number; lastY: number; dist: number } | null = null;

  // ---- The scripted control surface for the Playwright proof captures (DESIGN §6) --------
  // Every helper drives the real Game methods — no fake state — so the captures reproduce.
  (window as unknown as { __junction?: unknown }).__junction = {
    game,
    audio,
    newCity: (seed?: number) => game.newCity(seed),
    zoneRect: (kind: ZoneKind, c0: number, r0: number, c1: number, r1: number) => game.zoneRect(kind, c0, r0, c1, r1),
    road: (c0: number, r0: number, c1: number, r1: number) => game.road(c0, r0, c1, r1),
    rail: (c0: number, r0: number, c1: number, r1: number) => game.rail(c0, r0, c1, r1),
    wire: (c0: number, r0: number, c1: number, r1: number) => game.wire(c0, r0, c1, r1),
    pipe: (c0: number, r0: number, c1: number, r1: number) => game.pipe(c0, r0, c1, r1),
    station: (c: number, r: number) => game.station(c, r),
    plant: (c: number, r: number) => game.plant(c, r),
    source: (c: number, r: number) => game.source(c, r),
    bulldozeRect: (c0: number, r0: number, c1: number, r1: number) => game.bulldozeRect(c0, r0, c1, r1),
    setTax: (rate: number) => game.setTax(rate),
    setSpeed: (n: number) => game.setSpeed(n),
    setOverlay: (o: Overlay) => game.setOverlay(o),
    centerOn: (c: number, r: number) => game.centerOn(c, r),
    advance: (months: number) => game.advance(months),
    snapshot: () => game.snapshot(),
    forceBankruptcy: () => game.forceBankruptcy(),
    setState: (s: Game["state"]) => (game.state = s),
  };

  const gesture = (): void => {
    if (!gestured) gestured = true;
    void audio.resume();
  };

  // ---- Menu / HUD action dispatch --------------------------------------------------------
  function activate(action: string): void {
    if (action.startsWith("tool:")) {
      const tool = action.slice(5) as Tool;
      game.selectTool(game.activeTool === tool ? null : tool); // click the active tool to drop it
      return;
    }
    switch (action) {
      // Title / navigation.
      case "menu:play":
      case "menu:again": // fresh valley (title NEW CITY, bankruptcy TRY AGAIN)
        game.newCity();
        menuIndex = 0;
        break;
      case "menu:howto":
        game.showHowto();
        menuIndex = 0;
        break;
      case "menu:back":
      case "menu:menu": // how-to BACK, bankruptcy MENU → title
        game.backToTitle();
        menuIndex = 0;
        break;
      case "menu:resume":
        game.resume();
        game.paused = false; // Resume also clears any in-place pause so the city runs
        break;
      case "menu:restart": // paused RESTART → fresh valley, same seed
        game.restart();
        menuIndex = 0;
        break;
      case "menu:quit":
        game.quitToMenu();
        menuIndex = 0;
        break;
      // In-play HUD controls.
      case "mute":
        audio.toggleMute();
        break;
      case "pause":
        game.togglePause();
        break;
      case "speed":
        game.cycleSpeed();
        break;
      case "overlay":
        game.cycleOverlay();
        break;
      case "taxUp":
        game.taxUp();
        break;
      case "taxDown":
        game.taxDown();
        break;
    }
  }

  // Topmost clickable under (x,y) that is live for the current state. Outside play, only the
  // menu items fire (the HUD is not drawn there anyway).
  function hitClickable(x: number, y: number): boolean {
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      if (game.state !== "playing" && !c.action.startsWith("menu:")) continue;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        activate(c.action);
        return true;
      }
    }
    return false;
  }

  // Open the Esc overlay pause menu, which also freezes the board (specs/flow.md).
  function openPauseMenu(): void {
    game.openPauseMenu();
    menuIndex = 0;
  }

  // ---- Pointer routing -------------------------------------------------------------------
  function routeDown(x: number, y: number, button: number): void {
    if (hitClickable(x, y)) return;

    if (button === 2) {
      // Right button: cancel a held tool, and drag to pan the camera.
      if (game.state === "playing" && game.activeTool) game.selectTool(null);
      if (game.state === "playing") pan = { button: 2, lastX: x, lastY: y, dist: 0 };
      return;
    }

    // Left button acts on the board only while playing.
    if (game.state !== "playing") return;
    const hit = game.camera.screenToTile(x, y);
    if (!hit.inView || !inBounds(hit.col, hit.row)) return;

    const tool = game.activeTool;
    if (tool) {
      if (tool === "station" || tool === "plant" || tool === "source") {
        game.applyToolTiles(tool, [idx(hit.col, hit.row)]); // single-stamp tools place at once
      } else {
        toolDrag = { tool, col: hit.col, row: hit.row }; // zones / carriers paint on drag
      }
    } else {
      // No tool held: drag to pan, or a still click selects the tile to inspect.
      pan = { button: 0, lastX: x, lastY: y, dist: 0 };
    }
  }

  function routeUp(x: number, y: number, button: number): void {
    if (button === 2) {
      if (pan && pan.button === 2) pan = null;
      return;
    }
    if (toolDrag) {
      const hit = game.camera.screenToTile(x, y);
      let ec = toolDrag.col;
      let er = toolDrag.row;
      if (hit.inView && inBounds(hit.col, hit.row)) {
        ec = hit.col;
        er = hit.row;
      }
      game.applyDrag(toolDrag.tool, toolDrag.col, toolDrag.row, ec, er);
      toolDrag = null;
      return;
    }
    if (pan && pan.button === 0) {
      if (pan.dist < 5) {
        // A still left click with no tool selects (or deselects) the tile under it.
        const hit = game.camera.screenToTile(x, y);
        game.setSelected(hit.inView && inBounds(hit.col, hit.row) ? idx(hit.col, hit.row) : -1);
      }
      pan = null;
    }
  }

  function routeKey(k: string): void {
    const lower = k.toLowerCase();
    if (lower === "m") {
      audio.toggleMute();
      return;
    }
    if (game.state === "playing") {
      switch (k) {
        case " ":
          game.togglePause(); // in-place pause (distinct from the Esc menu)
          return;
        case "Tab":
          game.cycleOverlay();
          return;
        case "1":
        case "2":
        case "3":
          game.setSpeed(Number(k));
          return;
        case "+":
        case "=":
          game.setSpeed(game.speed + 1);
          return;
        case "-":
        case "_":
          game.setSpeed(game.speed - 1);
          return;
        case "[":
          game.taxDown();
          return;
        case "]":
          game.taxUp();
          return;
        case "Escape":
          // Esc first drops a held tool, then a selection, then opens the pause menu.
          if (game.activeTool) game.selectTool(null);
          else if (game.selectedTile >= 0) game.setSelected(-1);
          else openPauseMenu();
          return;
        default:
          return; // WASD / arrows drive continuous pan, handled in updatePan
      }
    }

    // Menu states — pointer + keyboard navigate the shared menus.ts list.
    const items = menuItems(game.state, game);
    if (items.length === 0) return;
    if (k === "ArrowUp" || k === "ArrowLeft" || lower === "w" || lower === "a") {
      menuIndex = (menuIndex - 1 + items.length) % items.length;
    } else if (k === "ArrowDown" || k === "ArrowRight" || lower === "s" || lower === "d") {
      menuIndex = (menuIndex + 1) % items.length;
    } else if (k === "Enter" || k === " ") {
      activate(items[menuIndex]!.action);
    } else if (k === "Escape") {
      if (game.state === "howto") activate("menu:back");
      else if (game.state === "paused") activate("menu:resume");
      else if (game.state === "bankrupt") activate("menu:menu");
    }
  }

  // Keep the keyboard selection in sync with a hovering pointer so the highlight agrees.
  function syncMenuIndexToPointer(): void {
    if (game.state === "playing") return;
    const items = menuItems(game.state, game);
    const pl = input.pointerLogical;
    for (let i = 0; i < items.length; i++) {
      const c = clickables.find((cl) => cl.action === items[i]!.action);
      if (c && pl.x >= c.x && pl.x <= c.x + c.w && pl.y >= c.y && pl.y <= c.y + c.h) {
        menuIndex = i;
        return;
      }
    }
  }

  function handleInput(pl: { x: number; y: number }): void {
    if (input.downs.length || input.ups.length || input.keys.length || input.wheel) gesture();
    for (const d of input.downs) routeDown(d.x, d.y, d.button);
    for (const u of input.ups) routeUp(u.x, u.y, u.button);
    if (input.wheel !== 0 && game.state === "playing") {
      // Wheel up (deltaY<0) zooms in; keeps the world point under the cursor fixed.
      game.camera.zoomAt((input.wheel > 0 ? -1 : 1) * ZOOM_STEP, pl.x, pl.y);
    }
    for (const k of input.keys) routeKey(k);
    input.clearEdges();
  }

  // Camera drag-pan + keyboard pan + edge-scroll (specs/controls.md). Panning never ticks.
  function updatePan(pl: { x: number; y: number }, dt: number): void {
    if (pan) {
      const dx = pl.x - pan.lastX;
      const dy = pl.y - pan.lastY;
      if (dx !== 0 || dy !== 0) {
        const s = game.camera.scale;
        game.camera.panBy(-dx / s, -dy / s); // drag the map with the pointer
        pan.dist += Math.hypot(dx, dy);
        pan.lastX = pl.x;
        pan.lastY = pl.y;
      }
    }
    if (game.state !== "playing") return;

    let dx = 0;
    let dy = 0;
    const h = input.held;
    if (h.has("ArrowLeft") || h.has("a")) dx -= 1;
    if (h.has("ArrowRight") || h.has("d")) dx += 1;
    if (h.has("ArrowUp") || h.has("w")) dy -= 1;
    if (h.has("ArrowDown") || h.has("s")) dy += 1;
    // Edge-scroll near the view band's borders (suppressed while a mouse drag-pan is active).
    if (!pan && pl.y >= VIEW_Y0 && pl.y <= VIEW_Y1 && pl.x >= 0 && pl.x <= STAGE_W) {
      if (pl.x < EDGE_MARGIN) dx -= 1;
      else if (pl.x > STAGE_W - EDGE_MARGIN) dx += 1;
      if (pl.y < VIEW_Y0 + EDGE_MARGIN) dy -= 1;
      else if (pl.y > VIEW_Y1 - EDGE_MARGIN) dy += 1;
    }
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      game.camera.panBy((dx / len) * PAN_SPEED * dt, (dy / len) * PAN_SPEED * dt);
    }
  }

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // clamp a long tab-switch stall so the sim never fast-forwards
    elapsed += dt;

    // Map the pointer into logical space with the live fit transform.
    const rect = canvas.getBoundingClientRect();
    input.setViewport(rect.width / STAGE_W, rect.left, rect.top);
    const pl = input.pointerLogical;

    // Hover tile drives the tool ghost / inspector highlight (only meaningful in play).
    if (game.state === "playing") {
      const hit = game.camera.screenToTile(pl.x, pl.y);
      game.setHover(hit.inView && inBounds(hit.col, hit.row) ? idx(hit.col, hit.row) : -1);
    } else {
      game.setHover(-1);
    }

    handleInput(pl);
    updatePan(pl, dt);
    syncMenuIndexToPointer();

    // Fixed-timestep simulation, scaled by the speed control, frozen while paused / on a menu.
    if (game.state === "playing" && !game.paused) {
      acc += dt * game.speed;
      let steps = 0;
      while (acc >= FIXED_STEP && steps < 600) {
        game.fixedStep(FIXED_STEP);
        acc -= FIXED_STEP;
        steps++;
      }
    } else {
      acc = 0; // drop the accumulator so no burst of ticks fires on resume
    }

    // Drain the sim's presentation queues (sim owns no audio / canvas — DESIGN §2.5).
    for (const cue of game.sndQueue) audio.play(cue);
    game.sndQueue.length = 0;
    for (const fx of game.fxQueue) bursts.spawn(fx);
    game.fxQueue.length = 0;
    haze.update(dt);
    bursts.update(dt);

    setRenderTime(elapsed);
    setMuted(audio.muted);
    setMenuIndex(menuIndex);
    setPointer(pl.x, pl.y);
    setDragAnchor(toolDrag ? idx(toolDrag.col, toolDrag.row) : -1);

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    clickables = render(ctx!, game, assets, { haze, bursts });

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
