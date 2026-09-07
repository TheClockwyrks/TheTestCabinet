// Wick — the screens wrapped around the simulation (specs/ui.md,
// specs/controls.md, specs/instrumentation.md "A deterministic core").
//
// The nine screens, the menus, the tick accumulator, and the routing of one
// action to what it does on the screen the game is on. Only `playing` ticks;
// every other screen freezes the world exactly as the tick that left
// `playing` left it. Every function here writes the world's live `WickState`
// in place and reads nothing from the clock or the renderer: what a tick or a
// menu sounds goes out through the cue sink the caller hands in, so the game
// mode binds the world's cue bus and the debug surface binds nothing, since a
// pose sounds nothing.
//
// What a menu item DOES lives here once, in `confirmItem`, so the pointer's
// click in `src/pointer.ts` takes an item exactly as `confirm` on it does.

import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  CUES,
  TICK_DT,
  TICK_EPSILON,
  TITLE_ITEMS,
  type ActionName,
  type CueName,
} from "./constants";
import { menuLength } from "./menus";
import { Rng } from "./rng";
import { makeTickContext } from "./sim/context";
import { acceptOffer, openLevelUp } from "./sim/progression";
import { tick } from "./sim/tick";
import {
  freshRun,
  idleRun,
  type Screen,
  type SwitchName,
  type WickState,
} from "./state";

/** `LIGHT THE LAMP`, the title entry a run leads away from and back to. */
const TITLE_LIGHT_THE_LAMP = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

/** `THE ALMANAC`, the entry `back` on the almanac returns to. */
const TITLE_THE_ALMANAC = TITLE_ITEMS.indexOf("THE ALMANAC");

/** `HOW TO PLAY`, the entry `back` on the how-to screen returns to. */
const TITLE_HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** Where a tick's or a menu's cues go. */
export type CueSink = (cue: CueName) => void;

/** A sink that sounds nothing: what a pose of the debug surface uses. */
export const SILENT: CueSink = () => undefined;

/** The actions each screen answers as press edges. */
export const SCREEN_ACTIONS: Readonly<Record<Screen, readonly ActionName[]>> = {
  title: ["up", "down", "confirm", "mute"],
  howto: ["back", "mute"],
  almanac: ["up", "down", "left", "right", "back", "mute"],
  playing: ["pause", "back", "mute"],
  levelup: ["up", "down", "confirm", "mute"],
  chest: ["confirm", "mute"],
  paused: ["up", "down", "confirm", "pause", "back", "mute"],
  fallen: ["up", "down", "confirm", "back", "mute"],
  dawn: ["up", "down", "confirm", "back", "mute"],
};

/** The screens the music loops on. */
const MUSIC_SCREENS: readonly Screen[] = [
  "playing",
  "levelup",
  "chest",
  "paused",
];

/** The screens a run is live on: the ones most poses apply to. */
export const RUN_SCREENS: readonly Screen[] = ["playing", "paused"];

/** The generator over `state`'s `rngState`. */
export function rngOf(state: WickState): Rng {
  return new Rng(() => state);
}

/** The looping cues the state calls for on this frame. */
export function wantedLoops(state: WickState): CueName[] {
  const wanted: CueName[] = [];
  if (MUSIC_SCREENS.includes(state.screen)) wanted.push(CUES.music);
  if (
    state.screen === "playing" &&
    state.run.weapons.some(
      (weapon) => weapon.id === "halo" || weapon.id === "corona",
    )
  ) {
    wanted.push(CUES.hum);
  }
  return wanted;
}

/**
 * Enters `screen` with its top menu entry highlighted and the almanac's two
 * indices back at `0`, which is what entering any screen leaves them at.
 */
function enter(state: WickState, screen: Screen): void {
  state.screen = screen;
  state.menuIndex = 0;
  state.almanacTab = 0;
  state.almanacScroll = 0;
}

// ---- Transitions ------------------------------------------------------------

/** Begin a fresh run and enter `playing`. */
export function startRun(state: WickState): void {
  state.run = freshRun();
  enter(state, "playing");
  state.accumulator = 0;
}

/**
 * Discard the run and return to `title` with `selected` highlighted:
 * `menuIndex` is `0` "on entering every screen but `title`, which selects the
 * entry that led away from it" (specs/ui.md). `LIGHT THE LAMP` is the default,
 * the entry every transition but the two menu screens' `back` leads away from.
 */
export function toTitle(
  state: WickState,
  selected: number = TITLE_LIGHT_THE_LAMP,
): void {
  state.run = idleRun();
  enter(state, "title");
  state.menuIndex = selected;
  state.accumulator = 0;
}

/** Discard the run and enter `howto`. */
export function toHowto(state: WickState): void {
  state.run = idleRun();
  enter(state, "howto");
  state.accumulator = 0;
}

/** Leave `howto` the way `back` there does: the title, `HOW TO PLAY` selected. */
export function leaveHowto(state: WickState): void {
  toTitle(state, TITLE_HOW_TO_PLAY);
}

/** Discard the run and enter `almanac`, on its first tab and first entry. */
export function toAlmanac(state: WickState): void {
  state.run = idleRun();
  enter(state, "almanac");
  state.accumulator = 0;
}

/** From `playing`, hold the world under `paused`. */
export function pause(state: WickState): void {
  if (state.screen !== "playing") return;
  enter(state, "paused");
  state.accumulator = 0;
}

/** From `paused`, return to `playing`; the run is untouched. */
export function resume(state: WickState): void {
  if (state.screen !== "paused") return;
  enter(state, "playing");
}

/** From `chest`, close the overlay. */
export function closeChest(state: WickState): void {
  if (state.screen !== "chest") return;
  state.run.chestResult = null;
  enter(state, "playing");
}

/** From a run screen, end the run as `ending` does, the run kept. */
export function endRun(
  state: WickState,
  ending: "fallen" | "dawn",
  sink: CueSink,
): void {
  if (!RUN_SCREENS.includes(state.screen)) return;
  enter(state, ending);
  state.accumulator = 0;
  sink(ending === "fallen" ? CUES.fallen : CUES.dawn);
}

/** From `playing` with a level-up queued, open the overlay. */
export function openLevelUpNow(state: WickState, sink: CueSink): boolean {
  if (state.screen !== "playing") return false;
  if (state.run.pendingLevelUps < 1) return false;
  const cues = new Set<CueName>();
  openLevelUp(state, rngOf(state), cues);
  state.accumulator = 0;
  for (const cue of cues) sink(cue);
  return true;
}

/**
 * Accept the offer at `index`: the transaction the choice names, run on the
 * world as it stands. The item is applied, the queue falls by one, and either
 * the next overlay opens or the run resumes.
 */
export function performChoose(
  state: WickState,
  index: number,
  sink: CueSink,
): void {
  const cues = new Set<CueName>();
  acceptOffer(makeTickContext(state, rngOf(state), state.held, cues), index);
  for (const cue of cues) sink(cue);
}

/**
 * The PLAYER's route to a choice: only the level-up overlay shows one, and only
 * its own offers can be highlighted. The debug surface calls `performChoose`
 * instead, because a driver is not walking this route.
 */
export function tryChoose(
  state: WickState,
  index: number,
  sink: CueSink,
): boolean {
  if (state.screen !== "levelup") return false;
  if (!Number.isInteger(index)) return false;
  if (index < 0 || index >= state.run.offers.length) return false;
  performChoose(state, index, sink);
  return true;
}

/** Set one driver switch. */
export function setSwitch(state: WickState, name: SwitchName, on: boolean) {
  state[name] = on;
}

// ---- Menus ------------------------------------------------------------------

/**
 * Hold `almanacScroll` around the highlight: it becomes the lesser of itself
 * and `menuIndex`, then the greater of that and the first row that keeps the
 * highlight in view, and is held within the list. Run after every move of
 * `menuIndex` on `almanac`, whichever moved it.
 */
export function followScroll(state: WickState): void {
  const count = menuLength(state);
  const near = Math.min(state.almanacScroll, state.menuIndex);
  const far = Math.max(near, state.menuIndex - ALMANAC_ROWS + 1);
  state.almanacScroll = Math.max(
    0,
    Math.min(far, Math.max(0, count - ALMANAC_ROWS)),
  );
}

/** Move the almanac's list by `rows`, holding it within the shown tab. */
export function scrollAlmanac(state: WickState, rows: number): void {
  if (state.screen !== "almanac" || rows === 0) return;
  const last = Math.max(0, menuLength(state) - ALMANAC_ROWS);
  state.almanacScroll = Math.max(0, Math.min(state.almanacScroll + rows, last));
}

/** Put the highlight on `index`, sounding `menu-move` when it moved. */
export function highlightTo(
  state: WickState,
  index: number,
  sink: CueSink,
): void {
  if (index < 0 || index >= menuLength(state)) return;
  if (index !== state.menuIndex) {
    state.menuIndex = index;
    sink(CUES.menuMove);
  }
  if (state.screen === "almanac") followScroll(state);
}

/** Move the highlight by `delta`, wrapping at both ends. */
function moveHighlight(state: WickState, delta: number, sink: CueSink): void {
  const length = menuLength(state);
  if (length === 0) return;
  state.menuIndex = (state.menuIndex + delta + length) % length;
  sink(CUES.menuMove);
  if (state.screen === "almanac") followScroll(state);
}

/** Show the tab at `index`, from the top of its list. */
export function selectTab(
  state: WickState,
  index: number,
  sink: CueSink,
): void {
  if (state.screen !== "almanac") return;
  if (index < 0 || index >= ALMANAC_TABS.length) return;
  if (index === state.almanacTab) return;
  state.almanacTab = index;
  state.menuIndex = 0;
  state.almanacScroll = 0;
  sink(CUES.menuMove);
}

/** Move the almanac's tab by `delta`, wrapping at both ends. */
function moveTab(state: WickState, delta: number, sink: CueSink): void {
  const length = ALMANAC_TABS.length;
  selectTab(state, (state.almanacTab + delta + length) % length, sink);
}

/**
 * Take the highlighted item of `onScreen`'s menu: what `confirm` does there,
 * and what a click inside an item's rectangle does. A screen whose menu
 * carries no confirmation, `almanac` among them, takes nothing.
 */
export function confirmItem(
  state: WickState,
  onScreen: Screen,
  sink: CueSink,
): void {
  switch (onScreen) {
    case "title":
      sink(CUES.menuConfirm);
      if (state.menuIndex === 0) startRun(state);
      else if (state.menuIndex === 1) toAlmanac(state);
      else toHowto(state);
      return;
    case "levelup":
      tryChoose(state, state.menuIndex, sink);
      return;
    case "chest":
      closeChest(state);
      return;
    case "paused":
      sink(CUES.menuConfirm);
      if (state.menuIndex === 0) resume(state);
      else toTitle(state);
      return;
    case "fallen":
    case "dawn":
      sink(CUES.menuConfirm);
      if (state.menuIndex === 0) startRun(state);
      else toTitle(state);
      return;
    default:
      return;
  }
}

/**
 * Answer one press edge of `action` against `onScreen`, the screen that was
 * up when the frame began, so a press that changes screens never also acts
 * on the screen it lands in. `mute` belongs to the engine's bus and is
 * answered by the controller, so it reaches nothing here.
 */
export function handleAction(
  state: WickState,
  action: ActionName,
  onScreen: Screen,
  sink: CueSink,
): void {
  if (!SCREEN_ACTIONS[onScreen].includes(action)) return;
  switch (onScreen) {
    case "title":
      if (action === "up") moveHighlight(state, -1, sink);
      else if (action === "down") moveHighlight(state, 1, sink);
      else if (action === "confirm") confirmItem(state, onScreen, sink);
      break;
    case "howto":
      if (action === "back") toTitle(state, TITLE_HOW_TO_PLAY);
      break;
    case "almanac":
      if (action === "up") moveHighlight(state, -1, sink);
      else if (action === "down") moveHighlight(state, 1, sink);
      else if (action === "left") moveTab(state, -1, sink);
      else if (action === "right") moveTab(state, 1, sink);
      else if (action === "back") toTitle(state, TITLE_THE_ALMANAC);
      break;
    case "playing":
      if (action === "pause" || action === "back") pause(state);
      break;
    case "levelup":
      if (action === "up") moveHighlight(state, -1, sink);
      else if (action === "down") moveHighlight(state, 1, sink);
      else if (action === "confirm") confirmItem(state, onScreen, sink);
      break;
    case "chest":
      if (action === "confirm") confirmItem(state, onScreen, sink);
      break;
    case "paused":
      if (action === "up") moveHighlight(state, -1, sink);
      else if (action === "down") moveHighlight(state, 1, sink);
      else if (action === "confirm") confirmItem(state, onScreen, sink);
      else if (action === "pause" || action === "back") resume(state);
      break;
    case "fallen":
    case "dawn":
      if (action === "up") moveHighlight(state, -1, sink);
      else if (action === "down") moveHighlight(state, 1, sink);
      else if (action === "confirm") confirmItem(state, onScreen, sink);
      else if (action === "back") toTitle(state);
      break;
  }
}

// ---- The clock --------------------------------------------------------------

/**
 * One whole tick, on `playing` alone, with the frame's held movement. Every
 * cue the tick raises goes to `sink` once, and a tick that leaves `playing`
 * discards the accumulator.
 */
export function tickOnce(state: WickState, sink: CueSink): void {
  if (state.screen !== "playing") return;
  const cues = new Set<CueName>();
  tick(state, rngOf(state), state.held, cues);
  if (state.screen !== "playing") state.accumulator = 0;
  for (const cue of cues) sink(cue);
}

/**
 * Feed `dt` seconds of frame time to the accumulator and consume every whole
 * tick in it. The remainder waits, and is discarded by a tick that leaves
 * `playing`. Off `playing` nothing accumulates, and `simTime` rises by the
 * frame's delta whatever the screen.
 */
export function runFrame(state: WickState, dt: number, sink: CueSink): void {
  state.simTime += dt;
  if (state.screen !== "playing") {
    state.accumulator = 0;
    return;
  }
  state.accumulator += dt;
  while (state.accumulator >= TICK_DT - TICK_EPSILON) {
    state.accumulator -= TICK_DT;
    tickOnce(state, sink);
    if (state.screen !== "playing") {
      state.accumulator = 0;
      return;
    }
  }
  if (state.accumulator < 0) state.accumulator = 0;
}
