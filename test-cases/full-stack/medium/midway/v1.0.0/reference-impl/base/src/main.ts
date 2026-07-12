// Midway — bootstrap and the fixed-timestep loop (specs/controls.md, specs/overview.md;
// DESIGN.md §5/§6).
//
// Loads the produced assets, fits the fixed 1280x720 stage into the window (letterboxed,
// centered, crisp at any pixel density and on load before any input), wires input, and
// runs the loop: the simulation advances in fixed FIXED_STEP ticks (scaled by the speed
// control, frozen while paused or in a menu) decoupled from rendering, which interpolates
// and draws every frame. It also ties the produced systems together — draining the sim's
// sound/particle event queues into the Audio + Particles players, holding the steam/sparkle
// loops over active stalls/rides, and driving the camera from keyboard + edge-scroll + wheel.

import { FIXED_STEP, PARK_Y0, PARK_Y1, STAGE_H, STAGE_W, TILE } from "./constants";
import type { RideKind, SceneryKind, StaffKind, StallKind, ToolKind } from "./constants";
import { screenToWorld } from "./park";
import { MODE } from "./mode";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { Particles } from "./particles";
import { Game } from "./sim";
import { Input, type Point } from "./input";
import { menuItems } from "./menus";
import { render, setDragCells, setMenuIndex, setMuted, setRenderTime } from "./render";
import type { Cell, Clickable, GameState, SpeedSetting } from "./types";

const PAN_SPEED = 480; // camera pan speed (world px per real second)
const EDGE = 22; // edge-scroll margin inside the park view (screen px)
const ZOOM_RATE = 0.0016; // wheel-notch -> zoom factor sensitivity

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Midway: 2D canvas context unavailable");

// Fit the fixed stage into the window: uniform scale, letterboxed, crisp at any DPR. Run
// once now so the very first painted frame is already correct (before any input/resize).
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
  const particles = new Particles(assets.fx);
  const game = new Game(MODE);
  const input = new Input();
  input.attach(canvas);

  let menuIndex = 0;
  let clickables: Clickable[] = [];
  let gestured = false;
  let elapsed = 0;

  // Path-tool drag: a press in the park starts a run, the release commits it.
  let dragging = false;
  let dragStart: Cell | null = null;

  // The steam/sparkle loop keys held over active stalls/rides last frame (to stop the stale).
  let prevLoops = new Set<string>();

  // ---- coordinate helpers ---------------------------------------------------------
  const cellAt = (p: Point): Cell => {
    const w = screenToWorld(game.world.camera, p.x, p.y);
    return { col: Math.floor(w.x / TILE), row: Math.floor(w.y / TILE) };
  };
  const inParkView = (p: Point): boolean => p.y > PARK_Y0 && p.y < PARK_Y1;

  // An orthogonal L-run of tiles from `from` to `to` (col leg, then row leg) — the path tool
  // preview and commit both use it, so the two agree exactly.
  function runCells(from: Cell, to: Cell): Cell[] {
    const cells: Cell[] = [];
    let c = from.col;
    let r = from.row;
    cells.push({ col: c, row: r });
    const dc = Math.sign(to.col - c);
    while (c !== to.col) {
      c += dc;
      cells.push({ col: c, row: r });
    }
    const dr = Math.sign(to.row - r);
    while (r !== to.row) {
      r += dr;
      cells.push({ col: c, row: r });
    }
    return cells;
  }

  // Expose the live game for the Playwright proof-capture script (inert during play),
  // mirroring valence's __valence. Helpers take world/tile coordinates directly.
  (window as unknown as { __midway?: unknown }).__midway = {
    game,
    audio,
    newPark: () => game.newPark(),
    devGrant: (cash: number) => game.devGrant(cash),
    devDay: (n: number) => game.devDay(n),
    devArrivals: (on: boolean) => game.devArrivals(on),
    layPath: (cells: [number, number][]) => game.layPath(cells),
    place: (kind: RideKind | StallKind, col: number, row: number) => game.placeAttraction(kind, col, row),
    scenery: (kind: SceneryKind, col: number, row: number) => game.placeScenery(kind, col, row),
    hire: (kind: StaffKind, col: number, row: number) => game.hireStaff(kind, col, row),
    setPrice: (target: number | "admission" | RideKind | StallKind, price: number) => game.setPrice(target, price),
    spawnGuests: (n: number) => game.spawnGuests(n),
    breakRide: (id?: number) => game.breakRide(id),
    litter: (col: number, row: number, amt: number) => game.litter(col, row, amt),
    fireworks: () => game.fireworks(),
    setState: (s: GameState) => game.setState(s),
  };

  const gesture = (): void => {
    if (!gestured) gestured = true;
    void audio.resume();
  };

  // ---- action routing (HUD + menus) ----------------------------------------------
  function selectTool(kind: ToolKind): void {
    game.tool.kind = kind;
    // Leaving the path tool cancels any in-flight drag.
    if (kind !== "path") endDrag();
  }

  function activate(action: string): void {
    if (action.startsWith("tool:")) {
      selectTool(action.slice(5) as ToolKind);
      return;
    }
    if (action.startsWith("buildRide:")) {
      game.tool.kind = "build";
      game.tool.buildRide = action.slice(10) as RideKind;
      game.tool.buildStall = null;
      game.tool.buildScenery = null;
      return;
    }
    if (action.startsWith("buildStall:")) {
      game.tool.kind = "build";
      game.tool.buildStall = action.slice(11) as StallKind;
      game.tool.buildRide = null;
      game.tool.buildScenery = null;
      return;
    }
    if (action.startsWith("buildScenery:")) {
      game.tool.kind = "build";
      game.tool.buildScenery = action.slice(13) as SceneryKind;
      game.tool.buildRide = null;
      game.tool.buildStall = null;
      return;
    }
    if (action.startsWith("staff:")) {
      game.tool.kind = "staff";
      game.tool.staffKind = action.slice(6) as StaffKind;
      return;
    }
    switch (action) {
      case "priceUp": {
        const a = game.selectedAttraction;
        if (a) game.setPrice(a.id, a.price + 1);
        break;
      }
      case "priceDown": {
        const a = game.selectedAttraction;
        if (a) game.setPrice(a.id, Math.max(0, a.price - 1));
        break;
      }
      case "speed":
        game.cycleSpeed();
        break;
      case "pause":
        // The HUD control pauses / resumes IN PLACE (no menu) — specs/controls.md.
        game.togglePause();
        break;
      case "mute":
        audio.toggleMute();
        break;
      case "menu:play":
        // NEW PARK — the open-ended run has no map select, so it starts the park directly.
        game.newPark();
        menuIndex = 0;
        break;
      case "menu:howto":
        game.setState("howto");
        menuIndex = 0;
        break;
      case "menu:restart":
      case "menu:again":
        game.restart(); // a fresh park (state -> playing)
        menuIndex = 0;
        break;
      case "menu:resume":
        game.state = "playing";
        game.paused = false; // Resume fully un-freezes (clears any in-place pause too)
        break;
      case "menu:back":
      case "menu:quit":
      case "menu:menu":
        game.setState("title");
        menuIndex = 0;
        break;
    }
  }

  // ---- board actions (a click in the park, per the active tool) -------------------
  function boardAction(p: Point): void {
    const { col, row } = cellAt(p);
    const w = screenToWorld(game.world.camera, p.x, p.y);
    switch (game.tool.kind) {
      case "build":
        if (game.tool.buildRide) game.placeAttraction(game.tool.buildRide, col, row);
        else if (game.tool.buildStall) game.placeAttraction(game.tool.buildStall, col, row);
        else if (game.tool.buildScenery) game.placeScenery(game.tool.buildScenery, col, row);
        break;
      case "staff":
        if (game.tool.staffKind) game.hireStaff(game.tool.staffKind, col, row);
        break;
      case "price":
        game.selectAtWorld(w.x, w.y); // select the attraction / guest / staff to inspect
        break;
      case "demolish":
        game.demolish(col, row);
        break;
      case "path":
        break; // the path tool works by drag (handled below), never a single boardAction
    }
  }

  function endDrag(): void {
    dragging = false;
    dragStart = null;
    setDragCells(null);
  }

  function cancelHeld(): void {
    game.tool.buildRide = null;
    game.tool.buildStall = null;
    game.tool.buildScenery = null;
    game.tool.staffKind = null;
    endDrag();
  }

  function routePress(p: Point): void {
    // Topmost clickable first (later-pushed regions draw on top).
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      // Outside play, only menu navigation clicks fire (HUD tool/price/build are play-only).
      if (game.state !== "playing" && !c.action.startsWith("menu:")) continue;
      if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
        activate(c.action);
        return;
      }
    }
    // Nothing in the HUD/menus consumed it — a click in the live park works the tool.
    if (game.state !== "playing" || !inParkView(p)) return;
    if (game.tool.kind === "path") {
      dragging = true;
      dragStart = cellAt(p); // committed on release; a press+release in one spot lays one tile
    } else {
      boardAction(p);
    }
  }

  // Esc: cancel a held build item / clear a selection first, else open the pause MENU
  // (which also freezes the board), distinct from the in-place Space pause (specs/flow.md).
  function escapePlaying(): void {
    if (game.tool.buildRide || game.tool.buildStall || game.tool.buildScenery || game.tool.staffKind) {
      cancelHeld();
      return;
    }
    if (game.selection !== "none") {
      game.selection = "none";
      game.selectedId = -1;
      return;
    }
    game.state = "paused";
    menuIndex = 0;
  }

  function routeKey(k: string): void {
    const lower = k.toLowerCase();
    if (lower === "m") {
      audio.toggleMute(); // mute works in every state
      return;
    }
    if (game.state === "playing") {
      if (k === " ") {
        game.togglePause();
        return;
      }
      if (k >= "1" && k <= "3") {
        game.speed = Number(k) as SpeedSetting;
        return;
      }
      if (lower === "f" || k === "+" || k === "=" || k === "-") {
        game.cycleSpeed();
        return;
      }
      if (k === "Escape") escapePlaying();
      // Arrows / WASD pan the camera continuously (handled from the held-key set each frame).
      return;
    }
    // Menu states: pointer and/or Up/Down (or W/S) move the selection, Enter/Space confirm.
    const items = menuItems(game.state, game);
    if (k === "ArrowUp" || lower === "w") menuIndex = (menuIndex - 1 + items.length) % items.length;
    else if (k === "ArrowDown" || lower === "s") menuIndex = (menuIndex + 1) % items.length;
    else if (k === "Enter" || k === " ") {
      if (items[menuIndex]) activate(items[menuIndex]!.action);
    } else if (k === "Escape") {
      if (game.state === "howto") activate("menu:back");
      else if (game.state === "paused") activate("menu:resume");
      else if (game.state === "gameover") activate("menu:menu");
    }
  }

  function handleInput(): void {
    if (input.presses.length || input.releases.length || input.keys.length || input.rightClicks || input.wheel) gesture();

    // Wheel zoom (only over the live park); clampCamera keeps the fit inside zoomCamera.
    if (input.wheel !== 0 && game.state === "playing") {
      game.zoomCamera(Math.exp(-input.wheel * ZOOM_RATE));
    }

    for (const p of input.presses) routePress(p);
    if (input.rightClicks > 0) cancelHeld();
    if (input.releases.length > 0 && dragging && dragStart) {
      const to = cellAt(input.releases[input.releases.length - 1]!);
      game.layPath(runCells(dragStart, to));
      endDrag();
    }
    for (const k of input.keys) routeKey(k);
    input.drain();
  }

  // Live path-drag preview (recomputed each frame so it tracks the pointer).
  function updateDragPreview(): void {
    if (dragging && dragStart) setDragCells(runCells(dragStart, cellAt(input.pointerLogical)));
    else setDragCells(null);
  }

  // Camera pan from held keys + edge-scroll — a keyboard pan and a mouse pan (specs/controls.md).
  function updateCamera(dt: number): void {
    if (game.state !== "playing") return;
    let dx = 0;
    let dy = 0;
    if (input.heldAny("ArrowLeft", "a")) dx -= 1;
    if (input.heldAny("ArrowRight", "d")) dx += 1;
    if (input.heldAny("ArrowUp", "w")) dy -= 1;
    if (input.heldAny("ArrowDown", "s")) dy += 1;
    const p = input.pointerLogical;
    if (inParkView(p)) {
      if (p.x < EDGE) dx -= 1;
      else if (p.x > STAGE_W - EDGE) dx += 1;
      if (p.y < PARK_Y0 + EDGE) dy -= 1;
      else if (p.y > PARK_Y1 - EDGE) dy += 1;
    }
    if (dx !== 0 || dy !== 0) game.panCamera(dx * PAN_SPEED * dt, dy * PAN_SPEED * dt);
  }

  // Hold a steam loop over each serving food/drink stall and a sparkle loop over each
  // running ride; stop the loops of anything now idle, broken, or demolished.
  function driveLoops(): void {
    const live = new Set<string>();
    if (game.state === "playing") {
      for (const a of game.attractions) {
        if (a.category === "ride" && (a.state === "running" || a.state === "loading")) {
          const key = `sparkle:${a.id}`;
          live.add(key);
          particles.ensureLoop(key, "sparkle", (a.col + a.w / 2) * TILE, (a.row + a.h / 2) * TILE);
        }
        if (a.category === "stall" && a.steam && a.connected && a.queue.length > 0) {
          const key = `steam:${a.id}`;
          live.add(key);
          particles.ensureLoop(key, "steam", (a.col + a.w / 2) * TILE, a.row * TILE + 4);
        }
      }
    }
    for (const key of prevLoops) if (!live.has(key)) particles.stopLoop(key);
    prevLoops = live;
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

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // clamp a background-tab hitch so the sim never leaps
    elapsed += dt;

    // Map the pointer into logical space with the live fit transform.
    const rect = canvas.getBoundingClientRect();
    input.setViewport(rect.width / STAGE_W, rect.left, rect.top);
    const pl = input.pointerLogical;
    game.pointerX = pl.x;
    game.pointerY = pl.y;

    handleInput();
    updateDragPreview();
    updateCamera(dt);
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
      // Frozen — in-place pause, the Esc menu, or a non-play screen. Drop the accumulator so
      // no burst of ticks fires on resume.
      acc = 0;
    }

    // Drain the sim's event queues into the produced audio + particle players.
    for (const cue of game.sndQueue) audio.play(cue);
    game.sndQueue.length = 0;
    for (const fx of game.fxQueue) particles.spawnOneShot(fx.kind, fx.x, fx.y); // one-shots only
    game.fxQueue.length = 0;
    driveLoops();
    particles.update(dt);

    setRenderTime(elapsed);
    setMuted(audio.muted);
    setMenuIndex(menuIndex);

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    clickables = render(ctx!, game, assets, particles);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
