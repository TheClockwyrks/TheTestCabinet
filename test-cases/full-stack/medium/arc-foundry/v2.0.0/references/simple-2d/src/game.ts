// Arc Foundry — the game: the state contract, the frame, and the three functions the
// engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game hands
// to the engine. `initialize` runs once and returns the state and the surface together
// as `[state, debug]`. `update` and `render` then run once each per frame — `update`
// first, with the frame's real elapsed SECONDS, then `render`.
//
// THE STATE IS A VALUE. The engine hands `update` the current state as a read-only view
// and stores what it returns; `render` draws that. `FoundryState` below is that value:
// the read-only view of `FoundryWorld`, whose every field is declared, named, and
// explained in `src/types.ts`. A frame never writes through the view it was handed — it
// copies it into a world of its own (`src/world.ts`), advances that, and returns it — so
// "rendering changes nothing" and "nothing but the update advances the simulation" are
// facts the compiler checks rather than comments.
//
// WHAT THE FRAME DOES, in order: read this frame's action edges once each and act on
// them, resolve the pointer's samples in the order they arrived, advance the simulation
// by the elapsed time the engine measured, play the cues the advance raised, raise the
// particle bursts it raised and step the ones already playing, and refresh the mirrors of
// what the runtime owns.

import { createDebugApi, type FoundryDebugApi } from "./debug";
import { loadAssets } from "./assets";
import { CUE_SPECS, playFrameCues } from "./audio";
import { registerDiagnostics } from "./diagnostics";
import { modifyHeld, pressed, registerActions } from "./input";
import { controls, inRect, type Control } from "./layout";
import { menuItems } from "./menus";
import { renderGame } from "./render";
import { spawnBurst, stepBursts } from "./particles";
import {
  BOARD_X,
  BOARD_Y,
  PANEL_X,
  STAGE_H,
  type ActionName,
  type ComboId,
  type DifficultyId,
  type MapId,
  type ScreenName,
} from "./constants";
import { boardOf } from "./board";
import {
  advance,
  cancelHeld,
  combineRecipeSelected,
  tryCombine,
  createWorld,
  cycleSpeed,
  cycleTargetingSelected,
  downgradeSelected,
  keepSelected,
  tryPlaceStamp,
  pullPress,
  removeSelected,
  select,
  selectAt,
  selected,
  setDifficulty,
  setMap,
  setMenuIndex,
  setOverlay,
  setPaused,
  setScreen,
  startRun,
  togglePause,
  upgradeComboSelected,
  tryUpgradeQuality,
} from "./sim";
import { COL } from "./theme";
import { thaw, type FoundryView } from "./world";
import type { FoundryWorld } from "./types";
import type {
  Game,
  InitApi,
  PointerSample,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";

// The surface is part of the module contract and is declared beside the game it types,
// so it is exported from here whichever module implements it.
export type { FoundryDebugApi };

/**
 * The whole of Arc Foundry's state, as everything but a transition sees it.
 *
 * `FoundryWorld` in `src/types.ts` is the same shape written as the simulation works in
 * it; this is the read-only view of exactly that, and it is what the engine holds, hands
 * out, and stores.
 */
export type FoundryState = FoundryView;

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the canvas is
 * cleared to each frame, so the letterbox bars match the yard itself.
 */
export const BACKGROUND: string = COL.void;

/** The right edge of the yard, past which a press belongs to the panel. */
const YARD_RIGHT = PANEL_X;

// ---- Acting on a control -------------------------------------------------

/** Where an entry sits in a screen's menu, or the first entry when it has none. */
function entryIndex(screen: ScreenName, action: string): number {
  const at = menuItems(screen).findIndex((item) => item.action === action);
  return at < 0 ? 0 : at;
}

/**
 * Commit one control, whether a press or a key reached it.
 *
 * Every control in the game funnels through here, so a pointer press on a control and
 * the key bound to the same act do exactly the same thing.
 */
function activate(
  w: FoundryWorld,
  api: Pick<UpdateApi, "audio">,
  action: string,
  payload?: string,
): void {
  if (action.startsWith("map-")) {
    setMap(w, action.slice(4) as MapId);
    setScreen(w, "difficultyselect");
    return;
  }
  if (action.startsWith("difficulty-")) {
    setDifficulty(w, action.slice(11) as DifficultyId);
    startRun(w);
    return;
  }
  switch (action) {
    case "salvage":
      setScreen(w, "mapselect");
      break;
    case "howto":
      setScreen(w, "howto");
      break;
    case "back":
      // "Returning to a menu highlights the entry that led away from it"
      // (specs/ui.md): the map select comes back on the map that was chosen, and
      // the title comes back on HOW TO PLAY when How To Play is what was left.
      if (w.screen === "difficultyselect") {
        setScreen(w, "mapselect", entryIndex("mapselect", `map-${w.mapId}`));
      } else {
        const led = w.screen === "howto" ? "howto" : "salvage";
        setScreen(w, "title", entryIndex("title", led));
      }
      break;
    case "restart":
    case "again":
      startRun(w);
      break;
    case "quit":
    case "menu":
      setScreen(w, "title");
      break;
    case "resume":
      setScreen(w, "playing");
      // Resuming from the menu clears any in-place pause too.
      setPaused(w, false);
      break;
    case "stamp":
      pullPress(w);
      break;
    case "keep":
      keepSelected(w);
      break;
    case "downgrade":
      downgradeSelected(w);
      break;
    case "combine":
      tryCombine(w);
      break;
    case "combine-special":
      if (payload) combineRecipeSelected(w, payload as ComboId);
      break;
    case "refine":
      // The panel's refinement control is the press's own: it refines whatever is
      // selected and never touches a combination tower's level (specs/hud.md).
      tryUpgradeQuality(w);
      break;
    case "upgrade": {
      // The `upgrade` ACTION raises the selected combination tower's level, and refines
      // the press when the selection is not a combination tower (specs/controls.md). It
      // is the keyboard's one binding for both; the panel's control is `refine`.
      const sel = selected(w);
      if (sel && sel.kind === "component" && sel.combo) upgradeComboSelected(w);
      else tryUpgradeQuality(w);
      break;
    }
    case "targeting":
      cycleTargetingSelected(w);
      break;
    case "dismantle":
      removeSelected(w);
      break;
    case "speed":
      cycleSpeed(w);
      break;
    case "pause":
      togglePause(w);
      break;
    case "mute":
      api.audio.setMuted(!api.audio.muted());
      break;
    case "combos":
      setOverlay(w, "combos", !w.showCombos);
      break;
    case "damage":
      setOverlay(w, "damage", !w.showDamage);
      break;
    default:
      // A press swallowed by an open overlay's backdrop commits nothing.
      break;
  }
}

/**
 * Back out, against the first of these that applies: a held rock is put away, the
 * selection is cleared, an open overlay is closed, on `playing` the pause menu opens, on
 * `paused` it closes, and on any other screen the game returns to the previous screen.
 */
function back(w: FoundryWorld, api: Pick<UpdateApi, "audio">): void {
  if (w.screen === "playing") {
    if (w.holding) {
      cancelHeld(w);
      return;
    }
    if (w.selectedId !== null) {
      select(w, null);
      return;
    }
    if (w.showCombos) {
      setOverlay(w, "combos", false);
      return;
    }
    if (w.showDamage) {
      setOverlay(w, "damage", false);
      return;
    }
    setScreen(w, "paused");
    return;
  }
  if (w.screen === "paused") {
    activate(w, api, "resume");
    return;
  }
  if (
    w.screen === "howto" ||
    w.screen === "mapselect" ||
    w.screen === "difficultyselect"
  ) {
    activate(w, api, "back");
    return;
  }
  if (w.screen === "victory" || w.screen === "overload")
    activate(w, api, "menu");
}

/**
 * Open the pause menu from `playing`, or close it and resume from `paused`.
 *
 * `specs/controls.md`: `pause-menu` "opens the pause menu on `playing`, and closes
 * it and resumes on `paused`", and nothing on any other screen. Unlike `back` it
 * runs no ladder, so "it opens the pause menu whatever is pending and leaves the
 * held rock, the selection, and the open overlay exactly as they were; resuming
 * hands all three back" — none of the three is touched here or by `resume`.
 */
function pauseMenu(w: FoundryWorld, api: Pick<UpdateApi, "audio">): void {
  if (w.screen === "playing") {
    setScreen(w, "paused");
    return;
  }
  if (w.screen === "paused") activate(w, api, "resume");
}

// ---- The keyboard --------------------------------------------------------

/** The actions the yard's own controls answer to, in the order they are checked. */
const YARD_ACTIONS: readonly ActionName[] = [
  "stamp",
  "keep",
  "downgrade",
  "combine",
  "upgrade",
  "targeting",
  "dismantle",
  "speed",
  "pause",
  "combos",
  "damage",
];

/**
 * Read this frame's action edges, once each, and act on them.
 *
 * Every edge is read here and nowhere else, which is what the engine's consume-on-read
 * edges ask for: two readers of the same action in one frame would split one press
 * between them. They are all read before any is acted on, so an action's availability
 * never depends on what an earlier one in the same frame did.
 */
function handleKeys(w: FoundryWorld, api: UpdateApi): void {
  const muteNow = pressed(api, "mute");
  const backNow = pressed(api, "back");
  const pauseMenuNow = pressed(api, "pause-menu");
  const upNow = pressed(api, "up");
  const downNow = pressed(api, "down");
  const confirmNow = pressed(api, "confirm");
  const yard = YARD_ACTIONS.map((a) => pressed(api, a));

  // Muting is bound to the engine's own bit, so it works from every screen.
  if (muteNow) activate(w, api, "mute");
  // `Escape` fires `back` and `pause-menu` together and one press resolves once, so
  // `back` runs first and spends the press (specs/controls.md). `KeyP` fires
  // `pause-menu` alone and reaches the line below.
  if (backNow) {
    back(w, api);
    return;
  }
  if (pauseMenuNow) {
    pauseMenu(w, api);
    return;
  }

  if (w.screen === "playing") {
    for (let i = 0; i < YARD_ACTIONS.length; i++) {
      if (yard[i]) activate(w, api, YARD_ACTIONS[i]!);
    }
    return;
  }

  const items = menuItems(w.screen);
  if (items.length === 0) return;
  if (upNow) setMenuIndex(w, (w.menuIndex - 1 + items.length) % items.length);
  else if (downNow) setMenuIndex(w, (w.menuIndex + 1) % items.length);
  else if (confirmNow) {
    const item = items[w.menuIndex];
    if (item) activate(w, api, item.action);
  }
}

// ---- The pointer ---------------------------------------------------------

/** The menu entry a point falls inside, with its place in the menu, or `null`. */
function menuAt(
  list: readonly Control[],
  x: number,
  y: number,
): { index: number; control: Control } | null {
  const items = list.filter((c) => c.kind === "menu");
  for (let i = 0; i < items.length; i++) {
    const c = items[i]!;
    if (inRect(x, y, c.x, c.y, c.w, c.h)) return { index: i, control: c };
  }
  return null;
}

/** Move the highlight to whichever menu entry a point is over. */
function syncMenuIndex(
  w: FoundryWorld,
  list: readonly Control[],
  x: number,
  y: number,
): void {
  const hit = menuAt(list, x, y);
  if (hit !== null) setMenuIndex(w, hit.index);
}

/**
 * Resolve one press at the pointer's position.
 *
 * The topmost control first, because a later-drawn control is drawn over an earlier one,
 * and only navigation fires off the yard, so a press aimed at the pause menu can never
 * reach the panel frozen behind it. A press that lands on no control and inside the yard
 * drops a held rock, or selects what stands there.
 */
function handlePress(
  w: FoundryWorld,
  api: UpdateApi,
  x: number,
  y: number,
): void {
  const list = controls(w);
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    if (c.disabled) continue;
    if (w.screen !== "playing" && c.kind !== "menu") continue;
    if (!inRect(x, y, c.x, c.y, c.w, c.h)) continue;
    if (c.kind === "menu") {
      // A menu entry moves the highlight on the press and is TAKEN on a release
      // inside the same region (specs/ui.md), so the press only records itself.
      syncMenuIndex(w, list, x, y);
      w.pressedMenu = c.action;
      return;
    }
    activate(w, api, c.action, c.payload);
    return;
  }
  // A press that fell outside every menu entry takes none, and leaves no gesture
  // for a later release to complete (specs/ui.md).
  w.pressedMenu = null;
  if (w.screen !== "playing") return;
  if (x >= YARD_RIGHT || y <= BOARD_Y || y > STAGE_H || x < BOARD_X) return;
  if (w.holding) {
    const at = boardOf(w.mapId).pixelToAnchor(x, y);
    tryPlaceStamp(w, at.col, at.row);
  } else {
    selectAt(w, x, y, modifyHeld(api));
  }
}

/**
 * Resolve this frame's pointer samples, one at a time, in the order they arrived.
 *
 * The pointer is read from the samples rather than from the frame's last position, so a
 * press that arrived part way through a sweep is resolved where it happened rather than
 * where the pointer ended up.
 */
function handlePointer(w: FoundryWorld, api: UpdateApi): void {
  const samples: readonly PointerSample[] = api.input.pointerSamples();
  for (const sample of samples) {
    w.pointerX = sample.x;
    w.pointerY = sample.y;
    if (sample.type === "down") handlePress(w, api, sample.x, sample.y);
    else if (sample.type === "move")
      syncMenuIndex(w, controls(w), sample.x, sample.y);
    else handleRelease(w, api, sample.x, sample.y);
  }
}

/**
 * Resolve one release at the pointer's position.
 *
 * Only a menu entry answers to a release: `specs/ui.md` takes one "only when both
 * edges of the gesture fall inside one entry's region", so the release is held
 * against the entry the press landed in and takes nothing when the two differ or
 * when the release fell outside every entry. Every other control commits on its
 * press, so a release reaches none of them.
 *
 * A touch contact is the same gesture: `specs/controls.md` gives its landing what a
 * pointer press gets and its lift what a release gets, so both arrive here as
 * samples and neither is told apart from the other.
 */
function handleRelease(
  w: FoundryWorld,
  api: UpdateApi,
  x: number,
  y: number,
): void {
  const pressedEntry = w.pressedMenu;
  w.pressedMenu = null;
  if (pressedEntry === null) return;
  const hit = menuAt(controls(w), x, y);
  if (hit === null || hit.control.disabled) return;
  if (hit.control.action !== pressedEntry) return;
  activate(w, api, hit.control.action, hit.control.payload);
}

// ---- The game the engine drives ------------------------------------------

export const game: Game<FoundryState, FoundryDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its keys, declare the
   * twelve cues and back each with its produced clip, load every produced sprite and
   * particle system, register the diagnostic sources, and build the complete initial
   * state on the title screen.
   *
   * Neither a diagnostic source nor the surface holds the state: a source is handed the
   * state current at the read, and every operation on the surface takes the state it
   * poses and returns the next one.
   */
  async initialize(
    api: InitApi<FoundryState>,
  ): Promise<[FoundryState, FoundryDebugApi]> {
    registerActions(api);
    registerDiagnostics(api);
    const assets = await loadAssets(api, CUE_SPECS);
    return [createWorld(assets), createDebugApi()];
  },

  /** Runs once per frame, before `render`: the next state, from the current one. */
  update(state: FoundryState, api: UpdateApi, dt: number): FoundryState {
    const w = thaw(state);

    // The pointer's position is refreshed before anything reads it, so a hit test in
    // this frame is against where the pointer is now.
    const pointer = api.input.pointer();
    w.pointerX = pointer.x;
    w.pointerY = pointer.y;

    handleKeys(w, api);
    handlePointer(w, api);

    advance(w, dt);

    // The advance raised its cues and its effects; the frame that raised them plays them.
    playFrameCues(api, w.cueQueue, w.screen === "playing");
    w.cueQueue = [];
    const raised = w.fxQueue;
    w.fxQueue = [];
    const bursts = stepBursts(w.bursts, dt);
    for (const event of raised) {
      const burst = spawnBurst(w.assets, event);
      if (burst) bursts.push(burst);
    }
    w.bursts = bursts;

    // The mirrors of what the runtime owns, refreshed on the state the frame leaves.
    w.muted = api.audio.muted();
    const settled = api.input.pointer();
    w.pointerX = settled.x;
    w.pointerY = settled.y;
    return w;
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: FoundryState, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
