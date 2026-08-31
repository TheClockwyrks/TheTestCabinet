// Wick — the screens wrapped around the simulation (specs/ui.md,
// specs/controls.md, specs/instrumentation.md "A deterministic core").
//
// The eight screens, the menus, the tick accumulator, and the routing of one
// action to what it does on the screen the game is on. Only `playing` ticks;
// every other screen freezes the world exactly as the tick that left
// `playing` left it. Every function here writes the world's live `WickState`
// in place and reads nothing from the clock or the renderer: what a tick or a
// menu sounds goes out through the cue sink the caller hands in, so the game
// mode binds the world's cue bus and the debug surface binds nothing, since a
// pose sounds nothing.

import {
  CUES,
  END_ITEMS,
  TICK_DT,
  TICK_EPSILON,
  TITLE_ITEMS,
  type ActionName,
  type CueName,
} from "./constants";
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

/** Where a tick's or a menu's cues go. */
export type CueSink = (cue: CueName) => void;

/** A sink that sounds nothing: what a pose of the debug surface uses. */
export const SILENT: CueSink = () => undefined;

/** The actions each screen answers as press edges. */
export const SCREEN_ACTIONS: Readonly<Record<Screen, readonly ActionName[]>> = {
  title: ["up", "down", "confirm", "mute"],
  howto: ["back", "mute"],
  playing: ["pause", "mute"],
  levelup: ["up", "down", "confirm", "mute"],
  chest: ["confirm", "mute"],
  paused: ["pause", "back", "mute"],
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

/** Enters `screen` with its top menu entry highlighted. */
function enter(state: WickState, screen: Screen): void {
  state.screen = screen;
  state.menuIndex = 0;
}

// ---- Transitions ------------------------------------------------------------

/** Begin a fresh run and enter `playing`. */
export function startRun(state: WickState): void {
  state.run = freshRun();
  enter(state, "playing");
  state.accumulator = 0;
}

/** Discard the run and return to `title`. */
export function toTitle(state: WickState): void {
  state.run = idleRun();
  enter(state, "title");
  state.accumulator = 0;
}

/** Discard the run and enter `howto`. */
export function toHowto(state: WickState): void {
  state.run = idleRun();
  enter(state, "howto");
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

/** On `levelup`, accept the offer at `index`. */
export function choose(
  state: WickState,
  index: number,
  sink: CueSink,
): boolean {
  if (state.screen !== "levelup") return false;
  if (!Number.isInteger(index)) return false;
  if (index < 0 || index >= state.run.offers.length) return false;
  const cues = new Set<CueName>();
  acceptOffer(makeTickContext(state, rngOf(state), state.held, cues), index);
  for (const cue of cues) sink(cue);
  return true;
}

/** Set one driver switch. */
export function setSwitch(state: WickState, name: SwitchName, on: boolean) {
  state[name] = on;
}

// ---- Menus ------------------------------------------------------------------

/** How many items the current screen's menu holds. */
export function menuLength(state: WickState): number {
  switch (state.screen) {
    case "title":
      return TITLE_ITEMS.length;
    case "levelup":
      return state.run.offers.length;
    case "fallen":
    case "dawn":
      return END_ITEMS.length;
    default:
      return 0;
  }
}

function moveHighlight(state: WickState, delta: number, sink: CueSink): void {
  const length = menuLength(state);
  if (length === 0) return;
  state.menuIndex = (state.menuIndex + delta + length) % length;
  sink(CUES.menuMove);
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
      else if (action === "confirm") {
        sink(CUES.menuConfirm);
        if (state.menuIndex === 0) startRun(state);
        else toHowto(state);
      }
      break;
    case "howto":
      if (action === "back") toTitle(state);
      break;
    case "playing":
      if (action === "pause") pause(state);
      break;
    case "levelup":
      if (action === "up") moveHighlight(state, -1, sink);
      else if (action === "down") moveHighlight(state, 1, sink);
      else if (action === "confirm") choose(state, state.menuIndex, sink);
      break;
    case "chest":
      if (action === "confirm") closeChest(state);
      break;
    case "paused":
      if (action === "pause") resume(state);
      else if (action === "back") toTitle(state);
      break;
    case "fallen":
    case "dawn":
      if (action === "up") moveHighlight(state, -1, sink);
      else if (action === "down") moveHighlight(state, 1, sink);
      else if (action === "confirm") {
        sink(CUES.menuConfirm);
        if (state.menuIndex === 0) startRun(state);
        else toTitle(state);
      } else if (action === "back") toTitle(state);
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
