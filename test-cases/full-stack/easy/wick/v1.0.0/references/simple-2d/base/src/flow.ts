// Wick — the screens, the menus, the frame's update, and the cues a frame
// raises (specs/ui.md, specs/controls.md, specs/instrumentation.md "A
// deterministic core").
//
// The simulation itself is `src/sim/`; this is the layer that decides which
// screen ticks, which actions each screen answers, how a frame's delta time
// becomes ticks, and which cues sound. Every function here works over a
// `Draft`, the writable copy a transition builds from the state the engine
// holds, and reads nothing from the renderer.

import {
  CUES,
  END_ITEMS,
  TICK_DT,
  TITLE_ITEMS,
  type ActionName,
  type CueName,
} from "./constants";
import type { Screen, WickState } from "./game";
import { Rng } from "./rng";
import { cloneState, freshRun, idleRun, type Draft } from "./state";
import { NOTHING_HELD, makeTickContext, type Held } from "./sim/context";
import { acceptOffer, openLevelUp } from "./sim/progression";
import { tick } from "./sim/tick";
import type { DeepReadonly } from "ts-essentials";

/** A count-down that would leave the accumulator this close to a tick runs it. */
const TICK_EPSILON = 1e-9;

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
export const MUSIC_SCREENS: readonly Screen[] = [
  "playing",
  "levelup",
  "chest",
  "paused",
];

/** The generator over the draft's own `rngState`. */
export function rngOf(draft: Draft): Rng {
  return new Rng(() => draft);
}

// ---- Transitions -----------------------------------------------------------

function enter(draft: Draft, screen: Screen): void {
  draft.screen = screen;
  draft.menuIndex = 0;
}

/** Begin a fresh run and enter `playing`. */
export function startRun(draft: Draft): void {
  draft.run = freshRun();
  draft.accumulator = 0;
  enter(draft, "playing");
}

/** Discard the run and return to `title`. */
export function toTitle(draft: Draft): void {
  draft.run = idleRun();
  draft.accumulator = 0;
  enter(draft, "title");
}

/** Discard the run and enter `howto`. */
export function toHowto(draft: Draft): void {
  draft.run = idleRun();
  draft.accumulator = 0;
  enter(draft, "howto");
}

/** From `playing`, hold the world under `paused`. */
export function pause(draft: Draft): void {
  if (draft.screen !== "playing") return;
  draft.accumulator = 0;
  enter(draft, "paused");
}

/** From `paused`, return to `playing`; the run is untouched. */
export function resume(draft: Draft): void {
  if (draft.screen !== "paused") return;
  enter(draft, "playing");
}

/** From `chest`, close the overlay. */
export function closeChest(draft: Draft): void {
  if (draft.screen !== "chest") return;
  draft.run.chestResult = null;
  enter(draft, "playing");
}

/** From a run screen, end the run as `ending` does, the run kept. */
export function endRun(
  draft: Draft,
  ending: "fallen" | "dawn",
  cues: Set<CueName>,
): void {
  draft.accumulator = 0;
  enter(draft, ending);
  cues.add(ending === "fallen" ? CUES.fallen : CUES.dawn);
}

/** From `playing` with a level-up queued, open the overlay. */
export function openLevelUpOverlay(draft: Draft, cues: Set<CueName>): boolean {
  if (draft.screen !== "playing") return false;
  if (draft.run.pendingLevelUps < 1) return false;
  openLevelUp(draft, rngOf(draft), cues);
  draft.accumulator = 0;
  return true;
}

/** On `levelup`, accept the offer at `index`. */
export function choose(
  draft: Draft,
  index: number,
  cues: Set<CueName>,
): boolean {
  if (draft.screen !== "levelup") return false;
  if (!Number.isInteger(index)) return false;
  if (index < 0 || index >= draft.run.offers.length) return false;
  acceptOffer(
    makeTickContext(draft, rngOf(draft), { ...NOTHING_HELD }, cues),
    index,
  );
  return true;
}

// ---- Menus -----------------------------------------------------------------

/** How many items the current screen's menu holds. */
export function menuLength(draft: DeepReadonly<WickState>): number {
  switch (draft.screen) {
    case "title":
      return TITLE_ITEMS.length;
    case "levelup":
      return draft.run.offers.length;
    case "fallen":
    case "dawn":
      return END_ITEMS.length;
    default:
      return 0;
  }
}

function moveHighlight(draft: Draft, delta: number, cues: Set<CueName>): void {
  const length = menuLength(draft);
  if (length === 0) return;
  draft.menuIndex = (draft.menuIndex + delta + length) % length;
  cues.add(CUES.menuMove);
}

/**
 * Answer one press edge on the current screen. `mute` is the engine's,
 * toggled through `toggleMute`; every other action is a transition over the
 * draft.
 */
export function handleAction(
  draft: Draft,
  action: ActionName,
  cues: Set<CueName>,
  toggleMute: () => void,
): void {
  if (!SCREEN_ACTIONS[draft.screen].includes(action)) return;
  if (action === "mute") {
    toggleMute();
    return;
  }
  switch (draft.screen) {
    case "title":
      if (action === "up") moveHighlight(draft, -1, cues);
      else if (action === "down") moveHighlight(draft, 1, cues);
      else if (action === "confirm") {
        cues.add(CUES.menuConfirm);
        if (draft.menuIndex === 0) startRun(draft);
        else toHowto(draft);
      }
      break;
    case "howto":
      if (action === "back") toTitle(draft);
      break;
    case "playing":
      if (action === "pause") pause(draft);
      break;
    case "levelup":
      if (action === "up") moveHighlight(draft, -1, cues);
      else if (action === "down") moveHighlight(draft, 1, cues);
      else if (action === "confirm") choose(draft, draft.menuIndex, cues);
      break;
    case "chest":
      if (action === "confirm") closeChest(draft);
      break;
    case "paused":
      if (action === "pause") resume(draft);
      else if (action === "back") toTitle(draft);
      break;
    case "fallen":
    case "dawn":
      if (action === "up") moveHighlight(draft, -1, cues);
      else if (action === "down") moveHighlight(draft, 1, cues);
      else if (action === "confirm") {
        cues.add(CUES.menuConfirm);
        if (draft.menuIndex === 0) startRun(draft);
        else toTitle(draft);
      } else if (action === "back") toTitle(draft);
      break;
  }
}

// ---- The clock -------------------------------------------------------------

/**
 * One whole tick, on `playing` alone, with the frame's held movement. A
 * tick that leaves `playing` discards the accumulator.
 */
export function tickOnce(draft: Draft, held: Held, cues: Set<CueName>): void {
  if (draft.screen !== "playing") return;
  tick(draft, rngOf(draft), held, cues);
  if (draft.screen !== "playing") draft.accumulator = 0;
}

/**
 * Feed `dt` seconds of frame time to the accumulator and consume every
 * whole tick in it. The remainder waits, and is discarded by a tick that
 * leaves `playing`. Off `playing` nothing accumulates.
 */
export function consumeTime(
  draft: Draft,
  dt: number,
  held: Held,
  cues: Set<CueName>,
): void {
  if (draft.screen !== "playing") {
    draft.accumulator = 0;
    return;
  }
  draft.accumulator += dt;
  while (draft.accumulator >= TICK_DT - TICK_EPSILON) {
    draft.accumulator -= TICK_DT;
    tickOnce(draft, held, cues);
    if (draft.screen !== "playing") {
      draft.accumulator = 0;
      return;
    }
  }
  if (draft.accumulator < 0) draft.accumulator = 0;
}

// ---- A frame ---------------------------------------------------------------

export interface FrameInput {
  /** The frame's delta time, in seconds. */
  dt: number;
  /** The press edges the frame read, in `ACTIONS` order. */
  pressed: readonly ActionName[];
  /** The movement actions as held values, sampled once for the frame. */
  held: Held;
  /** Toggle the engine's mute bit. */
  toggleMute: () => void;
}

/**
 * One frame over `view`: every edge is answered against the screen the
 * frame began on, `simTime` rises by the delta whatever the screen, and on
 * `playing` the delta becomes ticks. Returns the next state and the cues
 * the frame raised, each at most once, in the order they arose.
 */
export function runFrame(
  view: DeepReadonly<WickState>,
  input: FrameInput,
): { draft: Draft; cues: CueName[] } {
  const draft = cloneState(view);
  const cues = new Set<CueName>();
  const arrival = draft.screen;
  for (const action of input.pressed) {
    if (!SCREEN_ACTIONS[arrival].includes(action)) continue;
    handleAction(draft, action, cues, input.toggleMute);
  }
  draft.simTime += input.dt;
  consumeTime(draft, input.dt, input.held, cues);
  return { draft, cues: [...cues] };
}
