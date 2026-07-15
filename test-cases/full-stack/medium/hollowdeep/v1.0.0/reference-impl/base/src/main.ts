// Hollowdeep — bootstrap and the fixed-timestep loop (specs/controls.md, specs/overview.md).
//
// Loads the produced assets, fits the fixed 1280x720 stage into the window (letterboxed,
// centered, crisp at any pixel density and on load before any input), constructs the sound /
// particle / game / input systems, and runs the loop: the simulation advances in fixed
// FIXED_STEP ticks (scaled by the speed control, frozen while paused) decoupled from
// rendering, which interpolates and draws every frame while the live gas overlay and dust /
// steam bursts play through @test-cabinet/particle-runtime. Mirrors valence's main.ts.

import {
  FIXED_STEP,
  STAGE_H,
  STAGE_W,
  VIEW_H,
  VIEW_W,
  VIEW_X0,
  VIEW_Y0,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./constants";
import { clampCamera, screenToTile, screenToWorld } from "./world";
import { MODE } from "./mode";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { Bursts, GasOverlay } from "./particles";
import { Game } from "./sim";
import { Input } from "./input";
import { menuItems } from "./menus";
import { render, setDragRect, setMenuIndex, setMuted, setPointer, setRenderTime } from "./render";
import type { BuildKind, Clickable, Tool } from "./types";

// Camera feel (view-only tuning; the simulation's numbers live in constants.ts).
const PAN_SPEED = 560; // world px / s for keyboard + edge-scroll panning
const EDGE_MARGIN = 22; // px from a view edge that arms the edge-scroll
const WHEEL_ZOOM = 0.0016; // wheel-delta → zoom exponent

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Hollowdeep: 2D canvas context unavailable");

// Fit the fixed stage into the window: letterboxed, centered by the flex body, crisp at any
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function inView(x: number, y: number): boolean {
  return x >= VIEW_X0 && x < VIEW_X0 + VIEW_W && y >= VIEW_Y0 && y < VIEW_Y0 + VIEW_H;
}

async function main(): Promise<void> {
  const assets = await loadAssets();
  const audio = new Audio(assets.audioUrl);
  const gas = new GasOverlay(assets.fx.oxygen, assets.fx.co2);
  const bursts = new Bursts(assets.fx.dust, assets.fx.steam);
  const game = new Game(MODE);
  const input = new Input();
  input.attach(canvas);

  let menuIndex = 0;
  let clickables: Clickable[] = [];
  let gestured = false;
  let elapsed = 0;
  let pointerX = -1;
  let pointerY = -1;

  // Expose the live game for headless / dev driving. Helpers take tile coordinates directly
  // and drive the game's dev/control surface — inert during normal play.
  (window as unknown as { __hollowdeep?: unknown }).__hollowdeep = {
    game,
    audio,
    startColony: () => game.startColony(),
    digRect: (x0: number, y0: number, x1: number, y1: number) => game.devDigRect(x0, y0, x1, y1),
    place: (kind: BuildKind, tx: number, ty: number) => game.devPlace(kind, tx, ty),
    grant: (g: { ore?: number; material?: number; food?: number }) => game.grant(g),
    fillCavern: (o2: number) => game.fillCavern(o2),
    sealAndSpend: () => game.sealAndSpend(),
    setSpeed: (n: number) => game.setSpeed(n),
    tick: (n: number) => game.tick(n, FIXED_STEP),
  };

  const gesture = (): void => {
    if (!gestured) gestured = true;
    void audio.resume();
  };

  // ---- action routing (HUD buttons + menu items) ----
  function activate(action: string): void {
    if (action.startsWith("tool:")) {
      game.setTool(action.slice(5) as Tool);
      return;
    }
    if (action.startsWith("build:")) {
      game.selectBuild(action.slice(6) as BuildKind);
      return;
    }
    switch (action) {
      case "priority":
        game.togglePriority();
        break;
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
        game.startColony();
        menuIndex = 0;
        break;
      case "menu:howto":
        game.state = "howto";
        menuIndex = 0;
        break;
      case "menu:back":
      case "menu:quit":
      case "menu:menu":
        game.toMenu();
        menuIndex = 0;
        break;
      case "menu:resume":
        game.resumeMenu();
        game.paused = false; // Resume fully un-freezes (clears any in-place pause too).
        break;
      case "menu:restart":
        game.restart();
        menuIndex = 0;
        break;
    }
  }

  // Apply the active tool to a single tile (a click that did not become a drag).
  function applyToolAt(tx: number, ty: number): void {
    if (game.tool === "dig") game.markDig(tx, ty);
    else if (game.tool === "build" && game.buildKind) game.placeBuild(tx, ty, game.buildKind);
    else if (game.tool === "cancel") game.cancelAt(tx, ty);
  }

  // Apply the active tool across a tile rectangle (a completed left drag over the view).
  function applyToolRect(tx0: number, ty0: number, tx1: number, ty1: number): void {
    if (game.tool === "dig") {
      game.markDigRect(tx0, ty0, tx1, ty1);
      return;
    }
    const x0 = Math.min(tx0, tx1);
    const x1 = Math.max(tx0, tx1);
    const y0 = Math.min(ty0, ty1);
    const y1 = Math.max(ty0, ty1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (game.tool === "build" && game.buildKind) game.placeBuild(tx, ty, game.buildKind);
        else if (game.tool === "cancel") game.cancelAt(tx, ty);
      }
    }
  }

  function routeClick(x: number, y: number): void {
    // Topmost clickable first (later-pushed regions draw on top).
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      // Outside play, only navigation clicks fire (menu items).
      if (game.state !== "playing" && !c.action.startsWith("menu:")) continue;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        activate(c.action);
        return;
      }
    }
    // A bare click in the colony view applies the held tool at that tile (specs/controls.md).
    if (game.state === "playing" && inView(x, y)) {
      const t = screenToTile(game.world.camera, x, y);
      applyToolAt(t.tx, t.ty);
    }
  }

  function routeDrag(d: { x0: number; y0: number; x1: number; y1: number }): void {
    if (game.state !== "playing") return;
    if (!inView(d.x0, d.y0)) return; // a drag that began on the HUD is not a tool paint
    const a = screenToTile(game.world.camera, d.x0, d.y0);
    const b = screenToTile(game.world.camera, d.x1, d.y1);
    applyToolRect(a.tx, a.ty, b.tx, b.ty);
  }

  function openPauseMenu(): void {
    if (game.state !== "playing") return;
    game.openMenu();
    menuIndex = 0;
  }

  function routeKey(k: string): void {
    const lower = k.toLowerCase();
    if (lower === "m") {
      audio.toggleMute();
      return;
    }
    if (game.state === "playing") {
      if (k === " ") {
        // In-place pause: ticks halt but the board stays interactive (specs/controls.md).
        game.togglePause();
        return;
      }
      if (k === "1" || k === "2" || k === "3") {
        game.setSpeed(Number(k));
        return;
      }
      if (k === "Escape") {
        openPauseMenu();
        return;
      }
      // Arrow / WASD panning is continuous (driven from input.held each frame); ignore here.
      return;
    }
    // Menu states: pointer and/or Up/Down (or W/S) move the selection, Enter/Space confirm.
    const items = menuItems(game.state, game);
    if (items.length === 0) return;
    if (k === "ArrowUp" || lower === "w") menuIndex = (menuIndex - 1 + items.length) % items.length;
    else if (k === "ArrowDown" || lower === "s") menuIndex = (menuIndex + 1) % items.length;
    else if (k === "Enter" || k === " ") activate(items[menuIndex]!.action);
    else if (k === "Escape") {
      if (game.state === "howto") activate("menu:back");
      else if (game.state === "paused") activate("menu:resume");
      else if (game.state === "gameover") activate("menu:menu");
    }
  }

  // Point the menu highlight at whatever menu item the pointer is over (so mouse + keyboard
  // agree). Uses the previous frame's clickable regions.
  function syncMenuIndexToPointer(): void {
    if (game.state === "playing") return;
    const items = menuItems(game.state, game);
    for (let i = 0; i < items.length; i++) {
      const c = clickables.find((cl) => cl.action === items[i]!.action);
      if (c && pointerX >= c.x && pointerX <= c.x + c.w && pointerY >= c.y && pointerY <= c.y + c.h) {
        menuIndex = i;
        return;
      }
    }
  }

  // Move the camera from held keys, a mouse pan drag, and edge-scroll (playing only). Read
  // BEFORE input.drain() clears the per-frame pan deltas.
  function updateCamera(dt: number, scale: number): void {
    if (game.state !== "playing") return;
    const cam = game.world.camera;

    const axis = input.panAxis();
    if (axis.x !== 0 || axis.y !== 0) {
      cam.x += axis.x * PAN_SPEED * dt;
      cam.y += axis.y * PAN_SPEED * dt;
    }

    if (input.panDX !== 0 || input.panDY !== 0) {
      // Grab-scroll: dragging the world moves the camera the opposite way. Convert the client-
      // px drag to world px through the fit scale and the zoom.
      cam.x -= input.panDX / (scale * cam.zoom);
      cam.y -= input.panDY / (scale * cam.zoom);
    }

    if (inView(pointerX, pointerY)) {
      if (pointerX < VIEW_X0 + EDGE_MARGIN) cam.x -= PAN_SPEED * dt;
      else if (pointerX > VIEW_X0 + VIEW_W - EDGE_MARGIN) cam.x += PAN_SPEED * dt;
      if (pointerY < VIEW_Y0 + EDGE_MARGIN) cam.y -= PAN_SPEED * dt;
      else if (pointerY > VIEW_Y0 + VIEW_H - EDGE_MARGIN) cam.y += PAN_SPEED * dt;
    }

    if (input.wheel !== 0 && inView(pointerX, pointerY)) {
      const before = screenToWorld(cam, pointerX, pointerY);
      cam.zoom = clamp(cam.zoom * Math.exp(-input.wheel * WHEEL_ZOOM), ZOOM_MIN, ZOOM_MAX);
      const after = screenToWorld(cam, pointerX, pointerY);
      cam.x += before.x - after.x; // keep the world point under the cursor fixed
      cam.y += before.y - after.y;
    }

    clampCamera(game.world);
  }

  // The live dig-drag rectangle preview (render draws it only for the dig tool).
  function updateDragPreview(): void {
    if (game.state === "playing" && game.tool === "dig" && input.dragging && inView(input.dragging.x0, input.dragging.y0)) {
      const a = screenToTile(game.world.camera, input.dragging.x0, input.dragging.y0);
      const b = screenToTile(game.world.camera, input.dragging.x1, input.dragging.y1);
      setDragRect({ tx0: a.tx, ty0: a.ty, tx1: b.tx, ty1: b.ty });
    } else {
      setDragRect(null);
    }
  }

  function updateHover(): void {
    if (game.state === "playing" && inView(pointerX, pointerY)) {
      const t = screenToTile(game.world.camera, pointerX, pointerY);
      game.setHover(t.tx, t.ty);
    } else {
      game.setHover(-1, -1);
    }
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
    const scale = rect.width / STAGE_W;
    input.setViewport(scale, rect.left, rect.top);
    const pl = input.pointerLogical;
    pointerX = pl.x;
    pointerY = pl.y;

    // Consume input for this frame (any input counts as the audio-unlock gesture).
    if (input.clicks.length || input.keys.length || input.dragEnds.length || input.wheel || input.panDX || input.panDY) {
      gesture();
    }
    for (const c of input.clicks) routeClick(c.x, c.y);
    for (const d of input.dragEnds) routeDrag(d);
    for (const k of input.keys) routeKey(k);
    updateCamera(dt, scale);
    input.drain();

    updateHover();
    updateDragPreview();
    syncMenuIndexToPointer();

    // Fixed-step simulation, scaled by speed and frozen while paused (specs/controls.md).
    if (game.state === "playing" && !game.paused) {
      acc += dt * game.speed;
      let steps = 0;
      while (acc >= FIXED_STEP && steps < 600) {
        game.fixedStep(FIXED_STEP);
        acc -= FIXED_STEP;
        steps++;
      }
    } else {
      // Frozen — drop the accumulator so no burst of ticks fires on resume.
      acc = 0;
    }

    // Drain the sim's event queues into the presentation layer.
    for (const cue of game.sndQueue) audio.play(cue);
    game.sndQueue.length = 0;
    for (const fx of game.fxQueue) bursts.spawn(fx);
    game.fxQueue.length = 0;
    bursts.setVents(game.runningVents());
    audio.setMachineHum(game.anyMachineRunning());
    gas.update(dt);
    bursts.update(dt);

    // Push the frame's view state into the renderer and draw.
    setRenderTime(elapsed);
    setMuted(audio.muted);
    setMenuIndex(menuIndex);
    setPointer(pointerX, pointerY);

    const sx = canvas.width / STAGE_W;
    const sy = canvas.height / STAGE_H;
    ctx!.setTransform(sx, 0, 0, sy, 0, 0);
    clickables = render(ctx!, game, assets, gas, bursts);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
