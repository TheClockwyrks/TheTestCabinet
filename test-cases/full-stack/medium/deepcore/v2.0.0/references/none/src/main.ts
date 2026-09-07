// Deepcore — the runtime layer the game stands on (specs/overview.md, specs/controls.md).
//
// This build rests on no engine, so the layer beneath the game is written here: the
// frame loop and the delta time it measures, the letterboxed canvas fit, the keyboard
// and the mouse, audio, asset loading, and the diagnostics overlay. The loop hands the
// game one delta per frame and then draws it; every rate in the game is per second and
// integrated against that delta, so an interval of game time reaches the same state
// however it was divided into frames.
//
// The loop also owns the clock the debug surface reaches: `setAutoStep(false)` stops
// the wall clock advancing the simulation and `advance(seconds, frames)` runs an exact
// number of whole frames at an exact delta, which is what makes a scenario driven from
// code reproducible on any machine.

import { loadAssets } from "./assets";
import { Audio } from "./audio";
import type { LoopCue } from "./audio";
import { BACKGROUND, OVERLAY_TOGGLE_CODE, STAGE_H, STAGE_W } from "./constants";
import type { WorldSize } from "./constants";
import { installDebugApi } from "./debug";
import {
  buyFuel,
  buyRepair,
  buyUpgrade,
  dropOre,
  fillFuel,
  repairFull,
  sellCargo,
} from "./economy";
import { Game } from "./game";
import { Input, actionsForCode } from "./input";
import { buyItem, itemForHotkey, useItem } from "./items";
import { arrivalIndex, menuItems } from "./menus";
import { Diagnostics } from "./overlay";
import { Bursts } from "./particles";
import { render } from "./render";
import type { Clickable, View } from "./render";
import { fabricate } from "./rocket";
import { hasSave } from "./save";
import type { ItemId, OpenPanel, Ore, UpgradeTrack } from "./types";

/** The largest delta one frame may be worth. A backgrounded tab resumes with a gap
 *  measured in seconds, and a game asked to integrate that in one step tunnels through
 *  its own walls. */
const MAX_FRAME_DT = 0.25;

/** The cues that play as a sustained loop while their condition holds. */
const LOOP_CUES: LoopCue[] = ["drill", "thrust", "alarm-fuel", "alarm-core"];

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Deepcore: the 2D canvas context is unavailable");

/** The letterboxed fit of the logical stage inside the canvas, in device pixels. */
interface Fit {
  scale: number;
  offX: number;
  offY: number;
  dpr: number;
}

function fitCanvas(): Fit {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
  const cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const scale = Math.min(w / STAGE_W, h / STAGE_H);
  return {
    scale,
    offX: (w - STAGE_W * scale) / 2,
    offY: (h - STAGE_H * scale) / 2,
    dpr,
  };
}

async function main(): Promise<void> {
  const assets = await loadAssets();
  const audio = new Audio(assets.audioUrls);
  const bursts = new Bursts(assets.fx);
  const game = new Game();
  const input = new Input();
  const diagnostics = new Diagnostics();
  input.attach(canvas);
  registerDiagnostics(diagnostics, game);

  let clickables: Clickable[] = [];
  let elapsed = 0;
  let fit = fitCanvas();

  const gesture = (): void => void audio.resume();

  // -------------------------------------------------------------------------
  // Acting on a control, whether a click chose it or a key did
  // -------------------------------------------------------------------------

  function openPauseMenu(): void {
    // specs/modes.md: play does not resume from a death, so once one has been
    // taken nothing puts the mine back in front of the player.
    if (game.screen !== "in-mine" || game.dying) return;
    if (game.panel) {
      game.closePanel();
      return;
    }
    game.menuIndex = 0;
    game.screen = "paused";
  }

  function activate(action: string): void {
    if (action.startsWith("nav:")) {
      const to = action.slice(4) as typeof game.screen;
      game.menuIndex = arrivalIndex(game.screen, to, game.mode, hasSave());
      game.screen = to;
      return;
    }
    if (action.startsWith("mode:")) {
      game.chooseMode(action.slice(5) === "hardcore" ? "hardcore" : "standard");
      return;
    }
    if (action.startsWith("size:")) {
      game.newExpedition(game.pendingMode, action.slice(5) as WorldSize);
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
    if (action.startsWith("drop:")) {
      dropOre(game, action.slice(5) as Ore);
      return;
    }
    if (action.startsWith("buyitem:")) {
      buyItem(game, action.slice(8) as ItemId);
      return;
    }
    if (action.startsWith("useitem:")) {
      useItem(game, action.slice(8) as ItemId);
      return;
    }
    switch (action) {
      case "buyfuel:increment":
        buyFuel(game);
        break;
      case "buyfuel:full":
        fillFuel(game);
        break;
      case "buyrepair:increment":
        buyRepair(game);
        break;
      case "buyrepair:full":
        repairFull(game);
        break;
      case "again":
      case "restart":
        game.newExpedition(game.mode, game.worldSize);
        break;
      case "continue":
        game.loadExpedition();
        break;
      case "save":
        game.trySave();
        break;
      case "resume":
        game.screen = "in-mine";
        break;
      case "sys:pause":
        openPauseMenu();
        break;
      case "sys:inventory":
        game.toggleInventory();
        break;
      case "jettison":
        game.tryJettison();
        break;
      case "sys:mute":
        game.muted = !game.muted;
        break;
      case "notice:dismiss":
        game.dismissNotice();
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

  /** Whether a logical point falls inside a clickable's region. */
  function inside(c: Clickable, p: { x: number; y: number }): boolean {
    return p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
  }

  /**
   * Route one completed contact: both edges have to land in the same region.
   *
   * specs/controls.md: "A choice requires both of its edges inside one region... Two
   * edges falling in different regions, and an edge falling outside every region,
   * choose nothing."
   */
  function routeChoice(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    for (let i = clickables.length - 1; i >= 0; i--) {
      const c = clickables[i]!;
      if (c.disabled) continue;
      if (!inside(c, from)) continue;
      if (inside(c, to)) activate(c.action);
      return;
    }
  }

  /** Route one key that went down this frame, by the actions its code drives. */
  function routeKey(code: string): void {
    if (code === OVERLAY_TOGGLE_CODE) {
      diagnostics.toggle();
      return;
    }
    const actions = actionsForCode(code);
    if (actions.includes("mute")) {
      game.muted = !game.muted;
      return;
    }
    if (game.screen === "in-mine") {
      // The notice card has no claim on `pause`. specs/hazards.md makes the card
      // non-blocking and gives it exactly two ends — a click on it, and its own
      // fade — and specs/controls.md keeps `pause` bound to the pause menu the
      // whole time the card is up.
      //
      // specs/items.md: the six hotkeys and the jettison key "act throughout the
      // mine, with a building panel or the inventory overlay open exactly as with
      // the mine clear", and both paths run the same logic.
      for (let n = 1; n <= 6; n++) {
        if (!actions.includes(`supply${n}` as (typeof actions)[number]))
          continue;
        const id = itemForHotkey(n);
        if (id) useItem(game, id);
        return;
      }
      if (actions.includes("jettison")) {
        game.tryJettison();
        return;
      }
      if (actions.includes("pause")) openPauseMenu();
      else if (actions.includes("activate")) {
        if (!game.panel) game.activateNearbyBuilding();
      } else if (actions.includes("inventory")) game.toggleInventory();
      return;
    }
    // A menu screen: move the highlight, choose, or go back.
    const items = menuItems(game);
    if (!items.length) return;
    if (actions.includes("up"))
      game.menuIndex = (game.menuIndex - 1 + items.length) % items.length;
    else if (actions.includes("down"))
      game.menuIndex = (game.menuIndex + 1) % items.length;
    else if (actions.includes("activate"))
      activate(items[game.menuIndex]?.action ?? "");
    else if (actions.includes("pause")) {
      if (game.screen === "mode-select" || game.screen === "how-to-play")
        activate("nav:title");
      else if (game.screen === "size-select") activate("nav:mode-select");
      else if (game.screen === "paused") activate("resume");
      else if (game.screen === "victory" || game.screen === "game-over")
        activate("nav:title");
    }
  }

  function syncMenuIndexToPointer(pointer: { x: number; y: number }): void {
    if (game.screen === "in-mine") return;
    const items = menuItems(game);
    for (let i = 0; i < items.length; i++) {
      const c = clickables.find((cl) => cl.action === items[i]!.action);
      if (!c) continue;
      if (
        pointer.x >= c.x &&
        pointer.x <= c.x + c.w &&
        pointer.y >= c.y &&
        pointer.y <= c.y + c.h
      ) {
        game.menuIndex = i;
        return;
      }
    }
  }

  /** Run this frame's completed contacts and edge keys. */
  function drainEdges(): void {
    if (input.choices.length || input.codes.length) gesture();
    for (const c of input.choices) routeChoice(c.from, c.to);
    for (const code of input.codes) routeKey(code);
    input.drain();
  }

  // -------------------------------------------------------------------------
  // The frame
  // -------------------------------------------------------------------------

  function draw(): void {
    fit = fitCanvas();
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    // The letterbox bars carry the stage's own background.
    ctx!.fillStyle = BACKGROUND;
    ctx!.fillRect(0, 0, canvas.width, canvas.height);
    ctx!.setTransform(fit.scale, 0, 0, fit.scale, fit.offX, fit.offY);
    ctx!.beginPath();
    ctx!.rect(0, 0, STAGE_W, STAGE_H);
    ctx!.clip();
    const view: View = {
      time: elapsed,
      muted: game.muted,
      pointer: pointerLogical(),
    };
    clickables = render(ctx!, game, assets, bursts, view);
    diagnostics.draw(ctx!);
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
  }

  function pointerLogical(): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const cssScale = fit.scale / fit.dpr;
    return {
      x: (input.clientX - rect.left - fit.offX / fit.dpr) / cssScale,
      y: (input.clientY - rect.top - fit.offY / fit.dpr) / cssScale,
    };
  }

  /** One whole frame: hand the game a delta, drain what it produced, then draw. */
  function runFrame(dt: number): void {
    elapsed += dt;
    game.input = input.held();
    game.update(dt);
    audio.setMuted(game.muted);
    for (const cue of game.sndQueue) audio.play(cue);
    game.sndQueue.length = 0;
    for (const fx of game.fxQueue) bursts.spawn(fx);
    game.fxQueue.length = 0;
    bursts.update(dt);
    for (const cue of LOOP_CUES) audio.setLoop(cue, game.activeLoops.has(cue));
    audio.syncLoops();
    draw();
  }

  // -------------------------------------------------------------------------
  // The clock the debug surface reaches
  // -------------------------------------------------------------------------

  const clock = {
    setAutoStep(enabled: boolean): void {
      game.autoStep = enabled;
    },
    advance(seconds: number, frames: number): void {
      const step = seconds / frames;
      for (let i = 0; i < frames; i++) runFrame(step);
    },
  };

  installDebugApi({
    game,
    input,
    clock,
    drainEdges,
    clickables: () => clickables,
  });

  let last = performance.now();

  function frame(now: number): void {
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, (now - last) / 1000));
    last = now;

    drainEdges();
    syncMenuIndexToPointer(pointerLogical());
    const items = menuItems(game);
    if (game.menuIndex >= items.length)
      game.menuIndex = Math.max(0, items.length - 1);

    // While a caller holds the clock the loop keeps drawing but advances nothing, so
    // the canvas shows the state the most recent frame left.
    if (game.autoStep) runFrame(dt);
    else draw();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/** Register the values the diagnostics overlay watches. Each is a pure read. */
function registerDiagnostics(diagnostics: Diagnostics, game: Game): void {
  const n1 = (v: number): string => v.toFixed(1);
  const n0 = (v: number): string => v.toFixed(0);
  diagnostics.register(
    "screen",
    () => `${game.screen}   panel ${game.panel ?? "-"}`,
  );
  diagnostics.register(
    "world",
    () => `${game.mode}   ${game.worldSize}   core row ${game.coreRow}`,
  );
  diagnostics.register(
    "miner",
    () =>
      `${n0(game.miner.x)},${n0(game.miner.y)}  v ${n0(game.miner.vx)},${n0(game.miner.vy)}`,
  );
  diagnostics.register(
    "pose",
    () =>
      `${game.miner.state}  facing ${game.miner.facing}  grounded ${game.snapshot().miner.grounded}`,
  );
  diagnostics.register(
    "fuel",
    () =>
      `${n1(game.miner.fuel)}/${n1(game.maxFuel())}   hull ${n1(game.miner.hull)}/${n1(game.maxHull())}`,
  );
  diagnostics.register("cut", () => {
    const d = game.snapshot().miner.drilling;
    return d
      ? `${d.dir} (${d.col},${d.row}) ${(d.progress * 100).toFixed(0)}%`
      : "none";
  });
  diagnostics.register(
    "credits",
    () => `${game.credits}   depth ${n0(game.depthMeters())} m`,
  );
  diagnostics.register(
    "cargo",
    () =>
      `${game.slotsUsed()}/${game.cargoCap()} slots  ${n0(game.loadKg())}/${n0(game.liftLimitKg())} kg` +
      `${game.overloaded() ? "  OVERLOAD" : ""}`,
  );
  diagnostics.register(
    "satchel",
    () =>
      `res ${game.satchel.resonite}  cry ${game.satchel.cryenite}  core ${game.satchel.coreSample}`,
  );
  diagnostics.register(
    "tiers",
    () =>
      `F${game.tiers.fuel} D${game.tiers.drill} C${game.tiers.cargo} H${game.tiers.hull}` +
      ` J${game.tiers.jetpack} R${game.tiers.radiator} S${game.tiers.scanner}`,
  );
  diagnostics.register("core", () =>
    game.coreTimer === null ? "no sample" : `${n1(game.coreTimer)} s`,
  );
  diagnostics.register("scanner", () => {
    const s = game.scan;
    return s.locked
      ? `${s.target} at ${n1(s.distanceTiles ?? 0)} tiles`
      : "no lock";
  });
}

void main();
