// Arc Foundry — the runtime layer the game stands on (specs/overview.md, specs/controls.md).
//
// This game stands on no engine, so everything under the game is written here: the frame
// loop and the delta time it measures, fitting the fixed 1280 x 720 logical stage onto the
// canvas, pointer and keyboard input, audio, loading the produced assets, the diagnostics
// overlay, and the clock the debug surface takes off real time.
//
// One frame is one update followed by one render. `runFrame` is that frame, and it is the
// SINGLE path both the animation loop and the debug surface's `advance` run, so a driven
// scenario and a played one advance the game through exactly the same code.

import {
  ACTION_BY_CODE,
  BOARD_Y0,
  DIFFICULTY,
  FIXED_STEP,
  OVERLAY_KEY,
  PANEL_X,
  STAGE_H,
  STAGE_W,
  mapById,
} from "./constants";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { Bursts } from "./particles";
import { installDebugApi, drawDebugOverlay } from "./debug";
import { Game } from "./sim";
import { Input } from "./input";
import { menuItems, isMenuState, debugMenuAction } from "./menus";
import {
  render,
  setMenuIndex,
  setMuted,
  setOverlays,
  setRenderTime,
} from "./render";
import type { Action } from "./constants";
import type { Clickable, ComboType, Difficulty } from "./types";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Arc Foundry: 2D canvas context unavailable");

// The most simulation steps one frame may drain, so a tab returning from the background
// catches up without locking the page.
const MAX_STEPS_PER_FRAME = 600;

// The longest real frame the loop will believe. A longer gap is a stall, not elapsed play.
const MAX_FRAME_SECONDS = 0.25;

async function main(): Promise<void> {
  const assets = await loadAssets();
  const audio = new Audio(assets.audioUrl);
  const bursts = new Bursts(assets.fx);
  const game = new Game();

  let clickables: Clickable[] = [];
  let elapsed = 0;
  let acc = 0;
  // The diagnostics overlay, off until the backtick key toggles it.
  let showDiagnostics = false;
  // The keys currently down, so a LEVEL-read action such as `modify` can be read at the
  // moment it matters rather than sampled once a frame (specs/controls.md).
  const heldKeys = new Set<string>();

  // The manual clock (specs/instrumentation.md). `autoStep` is on for normal play: the
  // animation loop advances the game from the wall clock. The debug surface turns it off to
  // drive the game by exact spans of elapsed time, and back on for a live clip.
  const clock = { autoStep: true };

  // A fresh 32-bit seed per interactive run, so no two playthroughs draw the same component
  // sequence. A run entered through the debug surface keeps the seed `reset` set, so a
  // driven scenario stays reproducible.
  const randomSeed = (): number =>
    Math.floor(Math.random() * 0x100000000) >>> 0;

  const gesture = (): void => {
    void audio.resume();
  };

  // ---- The letterbox fit (specs/overview.md) ----------------------------------
  // The canvas fills the window; the stage is fitted inside it at a uniform scale, centered,
  // with the letterbox bars carrying the stage's own background colour. The device pixel
  // ratio is taken up by the backing store so the drawing stays crisp at any density.
  function fit(): { scale: number; offX: number; offY: number } {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const scale = Math.min(cssW / STAGE_W, cssH / STAGE_H);
    return {
      scale,
      offX: (cssW - STAGE_W * scale) / 2,
      offY: (cssH - STAGE_H * scale) / 2,
    };
  }

  // ---- Menu and control activation --------------------------------------------

  function activate(action: string, payload?: string): void {
    if (action.startsWith("map:")) {
      game.setMap(mapById(action.slice(4)));
      game.setScreen("difficultyselect");
      return;
    }
    if (action.startsWith("diff:")) {
      game.setDifficulty(DIFFICULTY[action.slice(5) as Difficulty]);
      game.startRun();
      game.reseedPress(randomSeed());
      return;
    }
    switch (action) {
      case "menu:play":
        game.setScreen("mapselect");
        break;
      case "menu:restart":
      case "menu:again":
        game.startRun();
        game.reseedPress(randomSeed());
        break;
      case "menu:howto":
        game.setScreen("howto");
        break;
      case "menu:back":
        game.setScreen(
          game.state === "difficultyselect" ? "mapselect" : "title",
        );
        break;
      case "menu:quit":
      case "menu:menu":
        game.setScreen("title");
        break;
      case "menu:resume":
        game.setScreen("playing");
        game.setPaused(false); // resuming from the menu clears any in-place pause too
        break;
      case "stamp":
        game.pullPress();
        break;
      case "keep":
        game.keepSelected();
        break;
      case "combine":
        game.combineSelected();
        break;
      case "combine-special":
        if (payload) game.combineRecipeSelected(payload as ComboType);
        break;
      case "refine":
        // The panel's refinement control is the press's own: it refines whatever is
        // selected and never touches a combination tower's level (specs/hud.md).
        game.upgradeQuality();
        break;
      case "upgrade":
        // The `upgrade` ACTION raises a selected combination tower's level, and refines
        // the press when the selection is not a combination tower (specs/controls.md).
        // It is the keyboard's one binding for both; the panel's control is `refine`.
        {
          const sel = game.selected();
          if (sel && sel.kind === "component" && sel.combo)
            game.upgradeComboSelected();
          else game.upgradeQuality();
        }
        break;
      case "downgrade":
        game.downgradeSelected();
        break;
      case "targeting":
        game.cycleTargetingSelected();
        break;
      case "dismantle":
        game.removeSelected();
        break;
      case "speed":
        game.cycleSpeed();
        break;
      case "pause":
        game.togglePause();
        break;
      case "mute":
        audio.toggleMute();
        game.muted = audio.muted;
        break;
      case "combos":
        game.setOverlay("combos", !game.uiCombos);
        break;
      case "damage":
        game.setOverlay("damage", !game.uiBoard);
        break;
      case "noop":
        // A press swallowed by an open overlay's backdrop — deliberately does nothing.
        break;
    }
  }

  // ---- The pointer (specs/controls.md) -----------------------------------------

  function onPointerMove(x: number, y: number): void {
    game.pointerX = x;
    game.pointerY = y;
    syncMenuIndexToPointer();
  }

  function onPointerDown(x: number, y: number): void {
    gesture();
    game.pointerX = x;
    game.pointerY = y;
    // The topmost control first: later-pushed regions draw on top, so they are pressed first.
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      // Off the yard only navigation presses fire: a menu screen draws no game controls.
      if (
        game.state !== "playing" &&
        !c.action.startsWith("menu:") &&
        !c.action.startsWith("map:") &&
        !c.action.startsWith("diff:")
      ) {
        continue;
      }
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        activate(c.action, c.payload);
        return;
      }
    }
    if (game.state === "playing" && x < PANEL_X && y > BOARD_Y0) {
      if (game.holding) {
        const a = game.board.pixelToAnchor(x, y);
        game.placeStamp(a.col, a.row);
      } else {
        game.selectAt(x, y, isActionHeld("modify"));
      }
    }
  }

  function onPointerUp(): void {
    // Every control commits on its press (specs/controls.md), so a release commits nothing.
  }

  // ---- The keyboard (specs/controls.md) ----------------------------------------

  function isActionHeld(action: Action): boolean {
    for (const code of heldKeys)
      if (ACTION_BY_CODE.get(code) === action) return true;
    return false;
  }

  // `back` resolves against the first of these that applies: a held rock is put away, the
  // selection is cleared, an open overlay is closed, on `playing` the pause menu opens, on
  // `paused` it closes, and on any other screen the game returns to the previous screen.
  function back(): void {
    if (game.state === "playing") {
      if (game.holding) {
        game.cancelHeld();
        return;
      }
      if (game.selectedId !== null) {
        game.select(null);
        return;
      }
      if (game.uiCombos) {
        game.setOverlay("combos", false);
        return;
      }
      if (game.uiBoard) {
        game.setOverlay("damage", false);
        return;
      }
      game.setScreen("paused");
      return;
    }
    if (game.state === "paused") {
      activate("menu:resume");
      return;
    }
    if (
      game.state === "howto" ||
      game.state === "mapselect" ||
      game.state === "difficultyselect"
    ) {
      activate("menu:back");
      return;
    }
    if (game.state === "victory" || game.state === "overload")
      activate("menu:menu");
  }

  function onKeyDown(code: string): void {
    gesture();
    heldKeys.add(code);
    // The diagnostics overlay is the runtime layer's, not a game control, so it toggles in
    // any state and bypasses the game's routing (specs/instrumentation.md).
    if (code === OVERLAY_KEY) {
      showDiagnostics = !showDiagnostics;
      return;
    }
    const action = ACTION_BY_CODE.get(code);
    if (!action) return;
    // `modify` is read as a level rather than a press edge: it stands for no control of its
    // own and only modifies the act it is held across.
    if (action === "modify") return;
    // Muting is bound to the runtime layer's own mute bit, so it toggles from any screen.
    if (action === "mute") {
      activate("mute");
      return;
    }
    if (action === "back") {
      back();
      return;
    }
    if (game.state === "playing") {
      switch (action) {
        case "stamp":
          activate("stamp");
          break;
        case "keep":
          activate("keep");
          break;
        case "downgrade":
          activate("downgrade");
          break;
        case "combine":
          activate("combine");
          break;
        case "upgrade":
          activate("upgrade");
          break;
        case "targeting":
          activate("targeting");
          break;
        case "dismantle":
          activate("dismantle");
          break;
        case "speed":
          activate("speed");
          break;
        case "pause":
          activate("pause");
          break;
        case "combos":
          activate("combos");
          break;
        case "damage":
          activate("damage");
          break;
      }
      return;
    }
    if (!isMenuState(game.state)) return;
    const items = menuItems(game.state);
    if (items.length === 0) return;
    if (action === "up")
      game.setMenuIndex((game.menuIndex - 1 + items.length) % items.length);
    else if (action === "down")
      game.setMenuIndex((game.menuIndex + 1) % items.length);
    else if (action === "confirm") {
      const item = items[game.menuIndex];
      if (item) activate(item.action);
    }
  }

  function onKeyUp(code: string): void {
    heldKeys.delete(code);
  }

  function syncMenuIndexToPointer(): void {
    if (!isMenuState(game.state)) return;
    const items = menuItems(game.state);
    for (let idx = 0; idx < items.length; idx++) {
      const c = clickables.find((cl) => cl.action === items[idx]!.action);
      if (
        c &&
        game.pointerX >= c.x &&
        game.pointerX <= c.x + c.w &&
        game.pointerY >= c.y &&
        game.pointerY <= c.y + c.h
      ) {
        game.setMenuIndex(idx);
        return;
      }
    }
  }

  const input = new Input({
    pointerMove: onPointerMove,
    pointerDown: onPointerDown,
    pointerUp: onPointerUp,
    keyDown: onKeyDown,
    keyUp: onKeyUp,
  });
  input.attach(canvas);

  // ---- One frame: an update, then a render -------------------------------------

  // The update. Every rate the game states is per second and integrated against the elapsed
  // time handed in here, and the speed multiplier scales what that span covers exactly as
  // specs/controls.md states. The span is drained in whole fixed steps so an interval of
  // simulation time reaches the same state however it was divided into frames.
  function update(seconds: number): void {
    if (game.state === "playing" && !game.paused) {
      acc += seconds * game.speed;
      // The number of whole steps this span carries is computed from the span, not counted
      // out by repeated subtraction, so the same interval of simulation time drains the
      // same number of steps however it was divided into frames. Repeated subtraction
      // accumulates a rounding error that costs a whole step over a second, which would
      // leave `advance(1, 1)` and `advance(1, 60)` in different places.
      const steps = Math.min(
        Math.floor(acc / FIXED_STEP + 1e-9),
        MAX_STEPS_PER_FRAME,
      );
      for (let i = 0; i < steps; i++) {
        game.syncView();
        game.fixedStep(FIXED_STEP);
      }
      acc -= steps * FIXED_STEP;
    } else {
      // Frozen — by the in-place pause, the pause menu, or a screen off the yard. Drop the
      // accumulator so no burst of steps fires on resume.
      acc = 0;
    }
    game.renderAlpha =
      game.state === "playing" && !game.paused ? acc / FIXED_STEP : 0;

    for (const cue of game.sndQueue) audio.play(cue);
    game.sndQueue.length = 0;
    for (const fx of game.fxQueue) bursts.spawn(fx);
    game.fxQueue.length = 0;
    bursts.update(seconds);
    elapsed += seconds;
  }

  // The render. It reads the game and draws it; it never changes it.
  function draw(): void {
    const { scale, offX, offY } = fit();
    const dpr = window.devicePixelRatio || 1;
    // A pointer event reports CSS pixels, so the device pixel ratio belongs to the drawing
    // transform below and to nothing else. The canvas covers the window at the origin, so a
    // client position maps onto the stage through the letterbox fit alone.
    input.setViewport(scale, offX, offY);

    setRenderTime(elapsed);
    setMuted(game.muted);
    setMenuIndex(game.menuIndex);
    setOverlays(game.uiCombos, game.uiBoard);

    // The letterbox bars carry the stage's background colour (specs/overview.md).
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.fillStyle = "#05080c";
    ctx!.fillRect(0, 0, canvas.width, canvas.height);
    ctx!.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);
    clickables = render(ctx!, game, assets, bursts);
    if (showDiagnostics) drawDebugOverlay(ctx!, game);
  }

  function runFrame(seconds: number): void {
    update(seconds);
    draw();
  }

  // ---- The debug and automation surface (specs/instrumentation.md) --------------
  // It routes through the very code normal play uses: the same frame, the same input path,
  // and the same control geometry the last rendered frame produced.
  installDebugApi({
    game,
    clock,
    runFrame,
    // Lay the frame out again before a reading, so the controls reported are the ones the
    // game as it now stands would draw. A render reads the game and changes nothing, so the
    // readings stay pure.
    refreshControls: draw,
    pointerMove: onPointerMove,
    pointerDown: onPointerDown,
    pointerUp: onPointerUp,
    keyDown: onKeyDown,
    keyUp: onKeyUp,
    // The inspector's action controls for the selected structure, in slot order.
    panelButtons: () =>
      clickables
        .filter((c) => c.panel)
        .map((c) => ({
          action: c.action,
          label: c.label ?? "",
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          disabled: Boolean(c.disabled),
        })),
    // The build panel's own two controls, the refinement control and the press control,
    // in the order the panel draws them.
    pressControls: () =>
      clickables
        .filter((c) => c.press)
        .map((c) => ({
          action: c.action,
          label: c.label ?? "",
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          disabled: Boolean(c.disabled),
        })),
    // The choices of the menu screen currently showing, in presentation order, each under
    // the fixed identifier the debug contract names it by. Empty on any screen that is not
    // a menu, which includes `playing` under an in-place pause.
    menuButtons: () => {
      if (!isMenuState(game.state)) return [];
      const out = [];
      for (const c of clickables) {
        const action = debugMenuAction(c.action);
        if (!action) continue;
        out.push({
          action,
          label: c.label ?? "",
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          disabled: Boolean(c.disabled),
        });
      }
      return out;
    },
    // The status bar's overlay, speed, pause, and mute controls, each carrying the value it
    // currently reads. Empty on any screen with no status bar.
    statusControls: () => {
      if (isMenuState(game.state)) return [];
      const state: Record<string, boolean | number> = {
        combos: game.uiCombos,
        damage: game.uiBoard,
        speed: game.speed,
        pause: game.paused,
        mute: game.muted,
      };
      return clickables
        .filter((c) => c.bar && c.action in state)
        .map((c) => ({
          action: c.action,
          label: c.label ?? "",
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          state: state[c.action]!,
        }));
    },
  });

  // ---- The animation loop ------------------------------------------------------

  let last = performance.now();

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
    last = now;
    // While the debug surface holds the clock the loop still draws every frame, but the
    // game advances only through `advance`, so a driven scenario is exact whatever the
    // machine is doing.
    if (clock.autoStep) runFrame(dt);
    else draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
