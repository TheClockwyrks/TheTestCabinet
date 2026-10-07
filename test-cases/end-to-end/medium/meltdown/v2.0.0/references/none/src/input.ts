// Meltdown — what an action and a pointer press do to the game
// (specs/controls.md).
//
// ONE RESOLUTION PATH. The keyboard, the pointer and the debug surface all end
// up here: `performAction` is what a bound key reaches, and `applyPointerSample`
// is what a press, a move and a release reach, whether the event came off the
// page or was reported through `window.__meltdown`. That is what makes a posed
// press and a player's press the same event (specs/instrumentation.md).
//
// A PRESS AND A RELEASE INSIDE ONE REGION ARE ONE INTERACTION. The region a press
// began in is held on the state, and the release only acts when it lands in the
// same one, so dragging off a control cancels it exactly as a player expects.

import {
  FLOOR_X0,
  FLOOR_X1,
  FLOOR_Y0,
  FLOOR_Y1,
  PANEL_X,
  TOWER_TYPES,
} from "./constants";
import {
  arm,
  movePreviewTo,
  place,
  rotatePreview,
  sell,
  upgrade,
  type CueSink,
} from "./build";
import { backFromScreen, confirmMenu, menuRects, moveMenu } from "./menus";
import { panelControls } from "./panel";
import { send } from "./sim";
import type { MeltdownState, PressRegion } from "./state";
import { towerAtPoint } from "./towers";
import { inRect, type Rect } from "./types";
import type { ActionName } from "./constants";

/** What the game reaches for the two things it does not own: cues and mute. */
export interface InputHost {
  /** Play a cue on the frame this interaction resolved. */
  cue: CueSink;
  /** Mute or unmute the runtime's audio bus. */
  setMuted(muted: boolean): void;
  /** Whether the runtime's audio bus is muted. */
  muted(): boolean;
}

/** Whether the screen takes the play actions and the floor's presses. */
function isLive(state: MeltdownState): boolean {
  return state.screen === "playing";
}

/** Whether the panel is drawn and its controls are operable. */
function panelIsLive(state: MeltdownState): boolean {
  return state.screen === "playing" || state.screen === "paused";
}

/** Toggle the pause screen, from live play and back again. */
function togglePause(state: MeltdownState): void {
  if (state.screen === "playing") {
    state.screen = "paused";
    state.menuIndex = 0;
    return;
  }
  if (state.screen === "paused") state.screen = "playing";
}

/** Toggle the game speed between `1` and `2`. */
function toggleSpeed(state: MeltdownState): void {
  state.speed = state.speed === 1 ? 2 : 1;
}

/**
 * `back`, resolved in the order `specs/controls.md` fixes: cancel a held
 * placement, else deselect, else pause from live play, else leave the screen.
 */
function goBack(state: MeltdownState): void {
  if (state.build !== null) {
    state.build = null;
    return;
  }
  if (state.selected !== null) {
    state.selected = null;
    return;
  }
  if (state.screen === "playing") {
    togglePause(state);
    return;
  }
  backFromScreen(state);
}

/** One action, performed on the state (specs/controls.md). */
export function performAction(
  state: MeltdownState,
  action: ActionName,
  host: InputHost,
): void {
  switch (action) {
    case "up":
    case "left":
      moveMenu(state, -1, host.cue);
      return;
    case "down":
    case "right":
      moveMenu(state, 1, host.cue);
      return;
    case "confirm":
      confirmMenu(state);
      return;
    case "back":
      goBack(state);
      return;
    case "pause":
      togglePause(state);
      return;
    case "mute":
      host.setMuted(!host.muted());
      state.muted = host.muted();
      return;
    case "rotate":
      if (isLive(state)) rotatePreview(state);
      return;
    case "send":
      if (isLive(state)) send(state);
      return;
    case "speed":
      if (isLive(state)) toggleSpeed(state);
      return;
    case "upgrade":
      if (isLive(state) && state.selected !== null) {
        upgrade(state, state.selected);
      }
      return;
    case "sell":
      if (isLive(state) && state.selected !== null) {
        sell(state, state.selected, host.cue);
      }
      return;
    default:
      armFromDigit(state, action);
      return;
  }
}

/** `arm1` to `arm8` arm the eight shop types in shop order. */
function armFromDigit(state: MeltdownState, action: ActionName): void {
  const index = TOWER_TYPES.findIndex((_type, i) => action === `arm${i + 1}`);
  if (index < 0 || !isLive(state)) return;
  arm(state, TOWER_TYPES[index]);
}

/** The region a stage position falls in, or `null` where nothing is there. */
export function regionAt(
  state: MeltdownState,
  x: number,
  y: number,
): PressRegion | null {
  if (x >= PANEL_X) {
    if (!panelIsLive(state)) return null;
    return panelRegionAt(state, x, y);
  }
  const rows = menuRects(state.screen);
  for (let index = 0; index < rows.length; index += 1) {
    if (inRect(rows[index], x, y)) return { kind: "menu", index };
  }
  if (
    isLive(state) &&
    x >= FLOOR_X0 &&
    x < FLOOR_X1 &&
    y >= FLOOR_Y0 &&
    y < FLOOR_Y1
  ) {
    return { kind: "floor" };
  }
  return null;
}

/** The panel region a position falls in: a shop entry, a control, or nothing. */
function panelRegionAt(
  state: MeltdownState,
  x: number,
  y: number,
): PressRegion | null {
  const controls = panelControls(state);
  for (const entry of controls.shop) {
    if (inRect(entry, x, y)) return { kind: "shop", type: entry.type };
  }
  const named: [string, Rect | null][] = [
    ["rotate", controls.rotate],
    ["cancel", controls.cancel],
    ["upgrade", controls.upgrade],
    ["sell", controls.sell],
    ["send", controls.send],
    ["speed", controls.speed],
    ["pause", controls.pause],
    ["mute", controls.mute],
  ];
  for (const [name, rect] of named) {
    if (rect !== null && inRect(rect, x, y)) return { kind: "control", name };
  }
  return null;
}

/** Whether two regions are the same one, so a release completes its press. */
function sameRegion(a: PressRegion | null, b: PressRegion | null): boolean {
  if (a === null || b === null) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "menu" && b.kind === "menu") return a.index === b.index;
  if (a.kind === "shop" && b.kind === "shop") return a.type === b.type;
  if (a.kind === "control" && b.kind === "control") return a.name === b.name;
  return true;
}

/** Take the interaction a completed press and release resolved to. */
function resolvePress(
  state: MeltdownState,
  region: PressRegion,
  host: InputHost,
): void {
  switch (region.kind) {
    case "menu": {
      if (state.menuIndex !== region.index) {
        state.menuIndex = region.index;
        host.cue("menu");
      }
      confirmMenu(state);
      return;
    }
    case "shop": {
      if (!isLive(state)) return;
      arm(state, region.type);
      state.hoverShop = region.type;
      return;
    }
    case "control":
      resolveControl(state, region.name, host);
      return;
    case "floor": {
      if (!isLive(state)) return;
      if (state.build !== null) {
        place(state, host.cue);
        return;
      }
      const tower = towerAtPoint(
        state.towers,
        state.floor,
        state.pointer.x,
        state.pointer.y,
      );
      state.selected = tower === null ? null : tower.id;
      return;
    }
  }
}

/** One panel control, operated. */
function resolveControl(
  state: MeltdownState,
  name: string,
  host: InputHost,
): void {
  switch (name) {
    case "rotate":
      rotatePreview(state);
      return;
    case "cancel":
      state.build = null;
      return;
    case "upgrade":
      if (state.selected !== null) upgrade(state, state.selected);
      return;
    case "sell":
      if (state.selected !== null) sell(state, state.selected, host.cue);
      return;
    case "send":
      send(state);
      return;
    case "speed":
      toggleSpeed(state);
      return;
    case "pause":
      togglePause(state);
      return;
    case "mute":
      host.setMuted(!host.muted());
      state.muted = host.muted();
      return;
    default:
      return;
  }
}

/** One pointer event, in logical stage units, applied to the game. */
export function applyPointerSample(
  state: MeltdownState,
  sample: { type: "down" | "move" | "up"; x: number; y: number },
  host: InputHost,
): void {
  state.pointer.x = sample.x;
  state.pointer.y = sample.y;

  if (sample.type === "move") reachMenuRow(state, sample.x, sample.y, host);

  if (sample.type === "move" || sample.type === "down") {
    if (state.build !== null && sample.x < PANEL_X) {
      movePreviewTo(state, sample.x, sample.y);
    }
    state.hoverShop = hoveredShop(state, sample.x, sample.y);
  }

  if (sample.type === "down") {
    state.pointer.down = true;
    state.press = regionAt(state, sample.x, sample.y);
    return;
  }
  if (sample.type === "up") {
    state.pointer.down = false;
    const region = regionAt(state, sample.x, sample.y);
    const began = state.press;
    state.press = null;
    if (sameRegion(began, region) && region !== null) {
      resolvePress(state, region, host);
    }
  }
}

/**
 * The pointer reaching a row of the current screen's menu highlights it
 * (specs/controls.md).
 *
 * Reaching a row is not taking it, so nothing is confirmed here. Off every row
 * the highlight stays on the row it last reached, and reaching the row already
 * highlighted changes nothing and raises nothing, which is why the cue sits
 * behind the same guard the keyboard's move does.
 */
function reachMenuRow(
  state: MeltdownState,
  x: number,
  y: number,
  host: InputHost,
): void {
  const rows = menuRects(state.screen);
  for (let index = 0; index < rows.length; index += 1) {
    if (!inRect(rows[index], x, y)) continue;
    if (state.menuIndex !== index) {
      state.menuIndex = index;
      host.cue("menu");
    }
    return;
  }
}

/** The shop entry a position is over, or `null` off every one of them. */
function hoveredShop(
  state: MeltdownState,
  x: number,
  y: number,
): MeltdownState["hoverShop"] {
  if (!panelIsLive(state)) return state.hoverShop;
  for (const entry of panelControls(state).shop) {
    if (inRect(entry, x, y)) return entry.type;
  }
  return null;
}
