// Holdfast — bootstrap and the fixed-timestep loop (DESIGN §4/§6, specs/controls.md).
//
// Loads the produced assets, fits the fixed 1280×720 stage into the window (letterboxed,
// centered, crisp at any pixel density and correct on first load before any input), wires
// the input layer, and runs the loop: the colony simulation advances in fixed FIXED_STEP
// ticks (scaled by the speed control, frozen while paused or off the play screen) decoupled
// from rendering, which draws every frame. Each frame it maps the pointer into logical
// space, routes presses/keys to the Game command surface, pans/zooms the camera, drains the
// sim's fx/sound queues into the particle and audio layers, and hands the live state to
// render(). It also exposes window.__holdfast for the Playwright proof-capture script.

import {
  CAM_PAN,
  EDGE_SCROLL,
  FIXED_STEP,
  STAGE_H,
  STAGE_W,
  VIEW_X0,
  VIEW_X1,
  VIEW_Y0,
  VIEW_Y1,
  ZOOM_LEVELS,
  type ResourceKind,
  type StructureKind,
  type WorkType,
} from "./constants";
import { screenToWorld, screenToTile } from "./world";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { Bursts } from "./particles";
import { Game } from "./sim";
import { Input, type PointerPoint } from "./input";
import { menuItems } from "./menus";
import {
  isWorkGridOpen,
  render,
  setDrag,
  setMenuIndex,
  setMuted,
  setPointer,
  setRenderTime,
  setWorkGrid,
} from "./render";
import type { Clickable, GameState, Phase } from "./types";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Holdfast: 2D canvas context unavailable");

// Fit the fixed stage into the window: letterboxed, centered, crisp at any device pixel
// ratio. Called on load (before any input) and on every resize.
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

async function main(): Promise<void> {
  const assets = await loadAssets();
  const audio = new Audio(assets.audioUrl);
  const bursts = new Bursts(assets.fx);
  const game = new Game();
  const input = new Input();
  input.attach(canvas);

  let menuIndex = 0;
  let clickables: Clickable[] = [];
  let gestured = false;
  let elapsed = 0;
  // A live designation drag: the logical-screen point the left press started at (or null).
  let boardDragFrom: PointerPoint | null = null;

  // Expose the live game for the Playwright proof-capture script (inert in normal play).
  // Every hook is a thin pass-through to the Game command surface (DESIGN §9).
  (window as unknown as { __holdfast?: unknown }).__holdfast = {
    game,
    audio,
    startBase: () => game.startBase(),
    setState: (s: GameState) => game.setState(s),
    camTo: (tx: number, ty: number) => game.camTo(tx, ty),
    designate: (kind: "chop" | "mine", tx0: number, ty0: number, tx1: number, ty1: number) => game.designateRect(tx0, ty0, tx1, ty1, kind),
    build: (kind: StructureKind, tx: number, ty: number) => game.build(kind, tx, ty),
    grant: (res: ResourceKind, n: number) => game.grant(res, n),
    setPriority: (id: number, work: WorkType, p: number) => game.setPriority(id, work, p),
    advance: (seconds: number) => game.advance(seconds),
    triggerRaid: (n?: number) => game.triggerRaid(n),
    forcePhase: (phase: Phase) => game.forcePhase(phase),
    hurtSettler: (id: number, dmg: number) => game.hurtSettler(id, dmg),
    killAll: () => game.killAll(),
  };

  // The first user gesture unlocks Web Audio (browsers block autoplay).
  const gesture = (): void => {
    if (!gestured) gestured = true;
    void audio.resume();
  };

  // Leaving the board (a menu transition, entering play) drops any in-flight tool/drag state.
  function clearBoardInteraction(): void {
    boardDragFrom = null;
    setDrag(null);
    setWorkGrid(false);
  }

  // Route an activated action string (from a clickable region or a menu confirm).
  function activate(action: string): void {
    if (action.startsWith("menu:")) {
      switch (action) {
        case "menu:play": // NEW COLONY starts the base colony directly (no map select).
        case "menu:restart":
        case "menu:again":
          game.startBase();
          menuIndex = 0;
          clearBoardInteraction();
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
          clearBoardInteraction();
          break;
        case "menu:resume":
          game.state = "playing";
          game.paused = false; // resume fully un-freezes (also clears any in-place pause)
          break;
      }
      return;
    }
    if (action.startsWith("select:")) {
      game.selectSettler(Number(action.slice("select:".length)));
      return;
    }
    if (action.startsWith("prio:")) {
      const [, idStr, work] = action.split(":");
      game.cyclePriority(Number(idStr), work as WorkType);
      return;
    }
    if (action.startsWith("build:")) {
      const kind = action.slice("build:".length) as StructureKind;
      if (game.tool === "build" && game.buildKind === kind) {
        game.tool = "none";
        game.buildKind = null;
      } else {
        game.tool = "build";
        game.buildKind = kind;
      }
      boardDragFrom = null;
      setDrag(null);
      return;
    }
    switch (action) {
      case "tool:designate":
        game.tool = game.tool === "designate" ? "none" : "designate";
        game.buildKind = null;
        boardDragFrom = null;
        setDrag(null);
        break;
      case "tool:cancel":
        game.tool = game.tool === "cancel" ? "none" : "cancel";
        game.buildKind = null;
        boardDragFrom = null;
        setDrag(null);
        break;
      case "workgrid":
        setWorkGrid(!isWorkGridOpen());
        break;
      case "speed":
        game.cycleSpeed();
        break;
      case "pause":
        game.togglePause();
        break;
      case "mute":
        audio.toggleMute();
        break;
    }
  }

  function onBoard(x: number, y: number): boolean {
    return x >= VIEW_X0 && x <= VIEW_X1 && y >= VIEW_Y0 && y <= VIEW_Y1;
  }

  // Select the living settler nearest a board click (within a tile), else deselect.
  function selectSettlerAt(x: number, y: number): void {
    const w = screenToWorld(game.camX, game.camY, game.zoom, x, y);
    let best: number | null = null;
    let bestD = 18; // ~ a tile's reach
    for (const s of game.livingSettlers()) {
      const d = Math.hypot(s.x - w.x, s.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    game.selectSettler(best);
  }

  // A left press: HUD/menu clickables first (topmost wins); else a board interaction.
  function routeDown(x: number, y: number): void {
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      // Off the play screen, only navigation (menu) clicks fire.
      if (game.state !== "playing" && !c.action.startsWith("menu:")) continue;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        activate(c.action);
        return;
      }
    }
    if (game.state !== "playing") return;
    // The work grid is modal: a click that missed its cells is swallowed, not passed through.
    if (isWorkGridOpen()) return;
    if (!onBoard(x, y)) return;

    const tile = screenToTile(game.camX, game.camY, game.zoom, x, y);
    switch (game.tool) {
      case "designate":
        boardDragFrom = { x, y }; // finalized on release (a lone click marks one tile)
        break;
      case "build":
        if (game.buildKind) game.placeGhost(game.buildKind, tile.tx, tile.ty);
        break;
      case "cancel":
        game.cancelAt(tile.tx, tile.ty);
        break;
      case "none":
        selectSettlerAt(x, y);
        break;
    }
  }

  // A left release: finalize a designation drag (a rectangle over the marked nodes).
  function routeUp(x: number, y: number): void {
    if (!boardDragFrom) return;
    const a = screenToTile(game.camX, game.camY, game.zoom, boardDragFrom.x, boardDragFrom.y);
    const b = screenToTile(game.camX, game.camY, game.zoom, x, y);
    game.designateRect(a.tx, a.ty, b.tx, b.ty);
    boardDragFrom = null;
  }

  function routeKey(k: string): void {
    const lower = k.toLowerCase();
    if (lower === "m") {
      audio.toggleMute();
      return;
    }
    if (game.state === "playing") {
      if (k === " ") {
        game.togglePause(); // Space pauses/resumes IN PLACE (board stays interactive).
        return;
      }
      if (k === "1" || k === "2" || k === "3") {
        game.setSpeed(Number(k));
        return;
      }
      if (k === "Escape") {
        // Esc peels back the current context, then opens the pause MENU.
        if (game.tool !== "none" || game.buildKind) {
          game.tool = "none";
          game.buildKind = null;
          boardDragFrom = null;
          setDrag(null);
        } else if (isWorkGridOpen()) {
          setWorkGrid(false);
        } else if (game.selectedSettlerId != null) {
          game.selectSettler(null);
        } else {
          game.state = "paused";
          menuIndex = 0;
        }
      }
      return;
    }

    // Menu states: Up/Left (or W/A) and Down/Right (or S/D) move the cursor; Enter/Space
    // confirms; Esc goes back (specs/controls.md "Menus").
    const items = menuItems(game.state, game);
    if (items.length === 0) return;
    if (k === "ArrowUp" || k === "ArrowLeft" || lower === "w" || lower === "a") menuIndex = (menuIndex - 1 + items.length) % items.length;
    else if (k === "ArrowDown" || k === "ArrowRight" || lower === "s" || lower === "d") menuIndex = (menuIndex + 1) % items.length;
    else if (k === "Enter" || k === " ") {
      const it = items[menuIndex];
      if (it) activate(it.action);
    } else if (k === "Escape") {
      if (game.state === "howto") activate("menu:back");
      else if (game.state === "paused") activate("menu:resume");
      else if (game.state === "gameover") activate("menu:menu");
    }
  }

  // In a menu, hovering an item's region moves the keyboard cursor to it (so pointer and
  // keyboard agree, and Enter confirms whatever the mouse is over).
  function syncMenuIndexToPointer(pl: PointerPoint): void {
    if (game.state === "playing") return;
    const items = menuItems(game.state, game);
    for (let idx = 0; idx < items.length; idx++) {
      const c = clickables.find((cl) => cl.action === items[idx]!.action);
      if (c && pl.x >= c.x && pl.x <= c.x + c.w && pl.y >= c.y && pl.y <= c.y + c.h) {
        menuIndex = idx;
        return;
      }
    }
  }

  function handleInput(): void {
    if (input.downs.length || input.keys.length || input.rightClicks || input.wheel) gesture();
    for (const d of input.downs) routeDown(d.x, d.y);
    for (const u of input.ups) routeUp(u.x, u.y);
    // A right-click cancels the held tool / build (specs/controls.md — tools stay active
    // until cancelled or another is chosen).
    if (input.rightClicks > 0 && game.state === "playing") {
      if (game.tool !== "none" || game.buildKind) {
        game.tool = "none";
        game.buildKind = null;
      }
      boardDragFrom = null;
    }
    for (const k of input.keys) routeKey(k);

    // Wheel zoom (playing only): step the zoom ladder and re-clamp the camera.
    if (input.wheel !== 0 && game.state === "playing") {
      const dir = Math.sign(input.wheel);
      game.zoomIndex = clamp(game.zoomIndex + dir, 0, ZOOM_LEVELS.length - 1);
      game.reclampCamera();
    }
    input.drain();
  }

  // Keyboard + edge-scroll camera pan (playing only; never pauses the sim, specs/controls.md).
  function updateCamera(pl: PointerPoint, dt: number): void {
    if (game.state !== "playing") return;
    let dx = 0;
    let dy = 0;
    if (input.anyHeld(["arrowleft", "a"])) dx -= 1;
    if (input.anyHeld(["arrowright", "d"])) dx += 1;
    if (input.anyHeld(["arrowup", "w"])) dy -= 1;
    if (input.anyHeld(["arrowdown", "s"])) dy += 1;
    // Edge scroll: only when the pointer is inside the colony view band.
    if (pl.x >= VIEW_X0 && pl.x <= VIEW_X1 && pl.y >= VIEW_Y0 && pl.y <= VIEW_Y1) {
      if (pl.x < VIEW_X0 + EDGE_SCROLL) dx -= 1;
      else if (pl.x > VIEW_X1 - EDGE_SCROLL) dx += 1;
      if (pl.y < VIEW_Y0 + EDGE_SCROLL) dy -= 1;
      else if (pl.y > VIEW_Y1 - EDGE_SCROLL) dy += 1;
    }
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    // Constant on-screen pan speed regardless of zoom (world delta = screen delta / zoom).
    const step = (CAM_PAN * dt) / game.zoom;
    game.panBy((dx / len) * step, (dy / len) * step);
  }

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // clamp a long stall (tab backgrounded) to avoid a tick storm
    elapsed += dt;

    // Map the pointer into logical space with the live fit transform.
    const rect = canvas.getBoundingClientRect();
    input.setViewport(rect.width / STAGE_W, rect.left, rect.top);
    const pl = input.pointerLogical;

    handleInput();
    syncMenuIndexToPointer(pl);
    updateCamera(pl, dt);

    // The in-flight designation drag preview (screen coords; render maps it to tiles).
    if (boardDragFrom && game.tool === "designate") setDrag({ x0: boardDragFrom.x, y0: boardDragFrom.y, x1: pl.x, y1: pl.y });
    else setDrag(null);

    // Advance the sim in fixed ticks, scaled by speed, frozen while paused or off-play.
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

    // Drain the sim's presentation queues into audio + particles.
    for (const cue of game.sndQueue) audio.play(cue);
    game.sndQueue.length = 0;
    for (const fx of game.fxQueue) bursts.spawn(fx);
    game.fxQueue.length = 0;
    bursts.update(dt);
    audio.setRaid(game.raidActive);

    // Push presentation state and draw.
    setRenderTime(elapsed);
    setMuted(audio.muted);
    setMenuIndex(menuIndex);
    setPointer(pl.x, pl.y);

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    clickables = render(ctx!, game, assets, bursts);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
