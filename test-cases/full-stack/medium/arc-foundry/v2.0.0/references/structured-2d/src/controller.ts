// Arc Foundry — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is that
// player's. Its tick is the ONE place the registered actions are read — the reader's
// edges are consumed per controller, so a second reader would split a press — and the
// one place the engine's ordered pointer samples reach the game, each resolved on its
// own, in arrival order, so a press that arrived part way through a sweep is resolved
// where it happened rather than where the pointer ended up.
//
// EVERY CONTROL FUNNELS THROUGH `activate`, so a pointer press on a control and the key
// bound to the same act do exactly the same thing, and `src/layout.ts` is the single
// place that says where a control sits — which is what the debug surface's readings
// report, so a caller can find a control without knowing how it was drawn.
//
// The controller holds no authoritative state: everything it decides is written straight
// onto the world's `FoundryState`, through the transitions in `src/sim.ts`. Controllers
// tick before any actor and before the game mode, so the mode's advance runs on the
// world this frame's input produced, and the yard's draw components render that.

import { PlayerController } from "@test-cabinet/structured-2d";
import type { WorldAudio } from "@test-cabinet/structured-2d";
import { boardOf } from "./board";
import {
  BOARD_X,
  BOARD_Y,
  PANEL_X,
  STAGE_H,
  type ActionName,
  type ComboId,
  type DifficultyId,
  type MapId,
} from "./constants";
import { controls, inRect, type Control } from "./layout";
import { menuItems } from "./menus";
import { foundryState, type FoundryState } from "./state";
import {
  cancelHeld,
  combineRecipeSelected,
  combineSelected,
  cycleSpeed,
  cycleTargetingSelected,
  downgradeSelected,
  keepSelected,
  placeStamp,
  pullPress,
  removeSelected,
  reseedPress,
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
  upgradeQuality,
} from "./sim";

/** The right edge of the yard, past which a press belongs to the panel. */
const YARD_RIGHT = PANEL_X;

/** A fresh seed for an interactive run, so no two playthroughs draw the same rolls. */
function freshSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

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
 * Commit one control, whether a press or a key reached it.
 *
 * Exported because the yard's controls and the menus are the same vocabulary from
 * either input, and this is the single place that vocabulary is interpreted.
 */
export function activate(
  w: FoundryState,
  audio: WorldAudio,
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
    reseedPress(w, freshSeed());
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
      setScreen(w, w.screen === "difficultyselect" ? "mapselect" : "title");
      break;
    case "restart":
    case "again":
      startRun(w);
      reseedPress(w, freshSeed());
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
      combineSelected(w);
      break;
    case "combine-special":
      if (payload) combineRecipeSelected(w, payload as ComboId);
      break;
    case "upgrade": {
      // Upgrading raises the selected combination tower's level, and refines the press
      // when the selection is not a combination tower (specs/controls.md).
      const sel = selected(w);
      if (sel && sel.kind === "component" && sel.combo) upgradeComboSelected(w);
      else upgradeQuality(w);
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
      audio.setMuted(!audio.muted());
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
function back(w: FoundryState, audio: WorldAudio): void {
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
    activate(w, audio, "resume");
    return;
  }
  if (
    w.screen === "howto" ||
    w.screen === "mapselect" ||
    w.screen === "difficultyselect"
  ) {
    activate(w, audio, "back");
    return;
  }
  if (w.screen === "victory" || w.screen === "overload")
    activate(w, audio, "menu");
}

export class FoundryController extends PlayerController {
  override tick(): void {
    const state = foundryState(this.world);
    const audio = this.world.audio;

    // The pointer's position is refreshed before anything reads it, so a hit test in
    // this frame is against where the pointer is now.
    const pointer = this.input.pointer();
    state.pointerX = pointer.x;
    state.pointerY = pointer.y;

    this.handleKeys(state, audio);
    this.handlePointer(state, audio);

    // The engine's own snapshot, mirrored for the frame being drawn.
    const settled = this.input.pointer();
    state.pointerX = settled.x;
    state.pointerY = settled.y;
  }

  /**
   * Read this frame's action edges, once each, and act on them.
   *
   * Every edge is read here and nowhere else, which is what the engine's per-controller
   * consume-on-read edges ask for. They are all read before any is acted on, so an
   * action's availability never depends on what an earlier one in the same frame did.
   */
  private handleKeys(w: FoundryState, audio: WorldAudio): void {
    const muteNow = this.input.pressed("mute");
    const backNow = this.input.pressed("back");
    const upNow = this.input.pressed("up");
    const downNow = this.input.pressed("down");
    const confirmNow = this.input.pressed("confirm");
    const yard = YARD_ACTIONS.map((a) => this.input.pressed(a));

    // Muting is bound to the engine's own bit, so it works from every screen.
    if (muteNow) activate(w, audio, "mute");
    if (backNow) {
      back(w, audio);
      return;
    }

    if (w.screen === "playing") {
      for (let i = 0; i < YARD_ACTIONS.length; i++) {
        if (yard[i]) activate(w, audio, YARD_ACTIONS[i]!);
      }
      return;
    }

    const items = menuItems(w.screen);
    if (items.length === 0) return;
    if (upNow) setMenuIndex(w, (w.menuIndex - 1 + items.length) % items.length);
    else if (downNow) setMenuIndex(w, (w.menuIndex + 1) % items.length);
    else if (confirmNow) {
      const item = items[w.menuIndex];
      if (item) activate(w, audio, item.action);
    }
  }

  /**
   * Resolve this frame's pointer samples, one at a time, in the order they arrived.
   *
   * A release commits nothing: every control commits on its press.
   */
  private handlePointer(w: FoundryState, audio: WorldAudio): void {
    for (const sample of this.input.pointerSamples()) {
      w.pointerX = sample.x;
      w.pointerY = sample.y;
      if (sample.type === "down") this.handlePress(w, audio, sample.x, sample.y);
      else if (sample.type === "move") syncMenuIndex(w, controls(w));
    }
  }

  /**
   * Resolve one press at the pointer's position.
   *
   * The topmost control first, because a later-drawn control is drawn over an earlier
   * one, and only navigation fires off the yard, so a press aimed at the pause menu can
   * never reach the panel frozen behind it. A press that lands on no control and inside
   * the yard drops a held rock, or selects what stands there.
   */
  private handlePress(
    w: FoundryState,
    audio: WorldAudio,
    x: number,
    y: number,
  ): void {
    const list = controls(w);
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i]!;
      if (c.disabled) continue;
      if (w.screen !== "playing" && c.kind !== "menu") continue;
      if (!inRect(x, y, c.x, c.y, c.w, c.h)) continue;
      activate(w, audio, c.action, c.payload);
      return;
    }
    if (w.screen !== "playing") return;
    if (x >= YARD_RIGHT || y <= BOARD_Y || y > STAGE_H || x < BOARD_X) return;
    if (w.holding) {
      const at = boardOf(w.mapId).pixelToAnchor(x, y);
      placeStamp(w, at.col, at.row);
    } else {
      // `modify` is read as a LEVEL rather than an edge: it stands for no control of its
      // own and only modifies the press it is held across, so reading it consumes
      // nothing and does not depend on the frame the key went down in.
      selectAt(w, x, y, this.input.value("modify") > 0);
    }
  }
}

/** Move the highlight to whichever menu entry the pointer is over. */
function syncMenuIndex(w: FoundryState, list: readonly Control[]): void {
  const items = list.filter((c) => c.kind === "menu");
  for (let i = 0; i < items.length; i++) {
    const c = items[i]!;
    if (inRect(w.pointerX, w.pointerY, c.x, c.y, c.w, c.h)) {
      setMenuIndex(w, i);
      return;
    }
  }
}
