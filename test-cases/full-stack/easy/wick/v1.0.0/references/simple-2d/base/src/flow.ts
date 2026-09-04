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
  ALMANAC_TABS,
  CUES,
  END_ITEMS,
  PAUSE_ITEMS,
  TICK_DT,
  TICK_EPSILON,
  TITLE_ITEMS,
  WHEEL_ROW,
  type ActionName,
  type CueName,
} from "./constants";
import { entriesOf, maxScroll, scrollToShow } from "./almanac";
import type { Screen, WickRect, WickState } from "./game";
import { hitRect, menuRects, tabRects } from "./menus";
import { Rng } from "./rng";
import { cloneState, freshRun, idleRun, type Draft } from "./state";
import { NOTHING_HELD, makeTickContext, type Held } from "./sim/context";
import { acceptOffer, openLevelUp } from "./sim/progression";
import { tick } from "./sim/tick";
import type { DeepReadonly } from "ts-essentials";

/** `LIGHT THE LAMP`, the title entry a run leads away from and back to. */
const TITLE_LIGHT_THE_LAMP = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

/** `THE ALMANAC`, the entry `back` on the almanac returns to. */
const TITLE_THE_ALMANAC = TITLE_ITEMS.indexOf("THE ALMANAC");

/** `HOW TO PLAY`, the entry `back` on the how-to screen returns to. */
const TITLE_HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

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
  draft.almanacTab = 0;
  draft.almanacScroll = 0;
}

/** Begin a fresh run and enter `playing`. */
export function startRun(draft: Draft): void {
  draft.run = freshRun();
  draft.accumulator = 0;
  enter(draft, "playing");
}

/**
 * Discard the run and return to `title` with `selected` highlighted:
 * `menuIndex` is `0` "on entering every screen but `title`, which selects the
 * entry that led away from it" (specs/ui.md). `LIGHT THE LAMP` is the default,
 * the entry every transition but the two menu screens' `back` leads away from.
 */
export function toTitle(
  draft: Draft,
  selected: number = TITLE_LIGHT_THE_LAMP,
): void {
  draft.run = idleRun();
  draft.accumulator = 0;
  enter(draft, "title");
  draft.menuIndex = selected;
}

/** Discard the run and enter `howto`. */
export function toHowto(draft: Draft): void {
  draft.run = idleRun();
  draft.accumulator = 0;
  enter(draft, "howto");
}

/** Discard the run and enter `almanac`, at the first entry of the first tab. */
export function toAlmanac(draft: Draft): void {
  draft.run = idleRun();
  draft.accumulator = 0;
  enter(draft, "almanac");
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
    case "almanac":
      return entriesOf(draft.almanacTab).length;
    case "levelup":
      return draft.run.offers.length;
    case "paused":
      return PAUSE_ITEMS.length;
    case "fallen":
    case "dawn":
      return END_ITEMS.length;
    default:
      return 0;
  }
}

/** The almanac's window follows the highlight, on every move of it. */
function followHighlight(draft: Draft): void {
  if (draft.screen !== "almanac") return;
  draft.almanacScroll = scrollToShow(
    draft.almanacScroll,
    draft.menuIndex,
    entriesOf(draft.almanacTab).length,
  );
}

/** Highlight the item at `index`, sounding `menu-move` where it moved. */
function highlight(draft: Draft, index: number, cues: Set<CueName>): void {
  if (draft.menuIndex === index) return;
  draft.menuIndex = index;
  cues.add(CUES.menuMove);
  followHighlight(draft);
}

function moveHighlight(draft: Draft, delta: number, cues: Set<CueName>): void {
  const length = menuLength(draft);
  if (length === 0) return;
  highlight(draft, (draft.menuIndex + delta + length) % length, cues);
}

/** Show the almanac's tab at `index`, its list back at its first entry. */
function selectTab(draft: Draft, index: number, cues: Set<CueName>): void {
  if (draft.almanacTab === index) return;
  draft.almanacTab = index;
  draft.menuIndex = 0;
  draft.almanacScroll = 0;
  cues.add(CUES.menuMove);
}

function moveTab(draft: Draft, delta: number, cues: Set<CueName>): void {
  const length = ALMANAC_TABS.length;
  selectTab(draft, (draft.almanacTab + delta + length) % length, cues);
}

/**
 * Take the highlighted item of the current screen's menu, exactly as
 * `confirm` on it does. The almanac's entries carry no `confirm`, and the
 * chest overlay has no menu, so neither is answered here.
 */
export function takeMenuItem(draft: Draft, cues: Set<CueName>): void {
  switch (draft.screen) {
    case "title":
      cues.add(CUES.menuConfirm);
      if (draft.menuIndex === 0) startRun(draft);
      else if (draft.menuIndex === 1) toAlmanac(draft);
      else toHowto(draft);
      break;
    case "levelup":
      choose(draft, draft.menuIndex, cues);
      break;
    case "paused":
      cues.add(CUES.menuConfirm);
      if (draft.menuIndex === 0) resume(draft);
      else toTitle(draft);
      break;
    case "fallen":
    case "dawn":
      cues.add(CUES.menuConfirm);
      if (draft.menuIndex === 0) startRun(draft);
      else toTitle(draft);
      break;
    default:
      break;
  }
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
      else if (action === "confirm") takeMenuItem(draft, cues);
      break;
    case "howto":
      if (action === "back") toTitle(draft, TITLE_HOW_TO_PLAY);
      break;
    case "almanac":
      if (action === "up") moveHighlight(draft, -1, cues);
      else if (action === "down") moveHighlight(draft, 1, cues);
      else if (action === "left") moveTab(draft, -1, cues);
      else if (action === "right") moveTab(draft, 1, cues);
      else if (action === "back") toTitle(draft, TITLE_THE_ALMANAC);
      break;
    case "playing":
      if (action === "pause" || action === "back") pause(draft);
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
      if (action === "up") moveHighlight(draft, -1, cues);
      else if (action === "down") moveHighlight(draft, 1, cues);
      else if (action === "confirm") takeMenuItem(draft, cues);
      else if (action === "pause" || action === "back") resume(draft);
      break;
    case "fallen":
    case "dawn":
      if (action === "up") moveHighlight(draft, -1, cues);
      else if (action === "down") moveHighlight(draft, 1, cues);
      else if (action === "confirm") takeMenuItem(draft, cues);
      else if (action === "back") toTitle(draft);
      break;
  }
}

// ---- The pointer -----------------------------------------------------------

/** A point on the stage, as a pointer sample reports one. */
export interface StagePoint {
  x: number;
  y: number;
}

/** This frame's pointer, in the stage's own coordinates. */
export interface PointerInput {
  /**
   * Where a device reporting a position OUT of contact rests, or `null`.
   *
   * The hover position and nothing else: "only a device reporting a position
   * while out of contact moves the highlight this way" (specs/controls.md), so
   * a finger, which reports a position only while it is down, never lands here.
   */
  at: StagePoint | null;
  /** The frame's primary press edges, in arrival order. */
  presses: readonly StagePoint[];
  /** The frame's primary release edges, in arrival order. */
  releases: readonly StagePoint[];
  /** The frame's wheel travel down the stage, in stage units. */
  wheel: number;
}

/** A pointer that rests off the stage and did nothing, for a driven frame. */
export const NO_POINTER: PointerInput = {
  at: null,
  presses: [],
  releases: [],
  wheel: 0,
};

/**
 * What a press armed, or `null`: the box its release has to lift inside.
 *
 * "A primary press edge inside the rectangle of the item at `menuIndex` `i` ...
 * arms that item. That press's release edge inside the same rectangle takes the
 * armed item" (specs/controls.md). The box is held with the target, because the
 * release only belongs to the same gesture when it lifts where the press
 * landed, and the screen with it, because leaving the screen takes the target
 * away. Like the contact in `src/input.ts` this is the DEVICE's state across
 * frames rather than the game's, so `WickState`, which `specs/state.md`
 * declares in full, does not carry it.
 */
interface Armed {
  readonly screen: Screen;
  readonly rect: WickRect;
  readonly kind: "item" | "tab";
  readonly index: number;
}

let armed: Armed | null = null;

/** Forget any armed gesture, so a fresh game starts with nothing armed. */
export function resetGesture(): void {
  armed = null;
}

/** The `menuIndex` the rectangle at `position` belongs to on this screen. */
function itemAt(draft: Draft, position: number): number {
  return draft.screen === "almanac" ? draft.almanacScroll + position : position;
}

/** The wheel moves the almanac's window, a whole row per `WHEEL_ROW`. */
function scrollList(draft: Draft, travel: number): void {
  if (draft.screen !== "almanac") return;
  const rows = Math.trunc(travel / WHEEL_ROW);
  if (rows === 0) return;
  const limit = maxScroll(entriesOf(draft.almanacTab).length);
  draft.almanacScroll = Math.min(
    Math.max(draft.almanacScroll + rows, 0),
    limit,
  );
}

/** Rule 1: a device out of contact inside an item's box highlights that item. */
function hover(draft: Draft, at: StagePoint, cues: Set<CueName>): void {
  const hovered = hitRect(menuRects(draft), at.x, at.y);
  if (hovered >= 0) highlight(draft, itemAt(draft, hovered), cues);
}

/** Rule 2, first half: a press highlights the box it lands in and arms it. */
function press(draft: Draft, at: StagePoint, cues: Set<CueName>): void {
  armed = null;
  const screen = draft.screen;
  const tabs = tabRects(draft);
  const tab = hitRect(tabs, at.x, at.y);
  if (tab >= 0) {
    armed = { screen, rect: tabs[tab]!, kind: "tab", index: tab };
    return;
  }
  // The box is found before the highlight moves, because moving it on the
  // almanac can move the window under the very box the press landed in.
  const rects = menuRects(draft);
  const position = hitRect(rects, at.x, at.y);
  if (position < 0) return;
  const index = itemAt(draft, position);
  const rect = rects[position]!;
  highlight(draft, index, cues);
  armed = { screen, rect, kind: "item", index };
}

/**
 * Take what a release inside its armed box armed: exactly what `confirm` on it
 * does, which on an almanac entry, the one menu that answers no `confirm`, is
 * nothing, and on `howto`, which answers no `confirm` either, is what `back`
 * there does.
 */
function take(draft: Draft, cues: Set<CueName>): void {
  if (draft.screen === "howto") {
    toTitle(draft, TITLE_HOW_TO_PLAY);
    return;
  }
  if (draft.screen === "chest") {
    closeChest(draft);
    return;
  }
  if (draft.screen === "almanac") return;
  takeMenuItem(draft, cues);
}

/**
 * Rule 2, second half: a release inside the box its press armed takes what it
 * armed; a release anywhere else disarms and takes nothing.
 */
function release(draft: Draft, at: StagePoint, cues: Set<CueName>): void {
  const gesture = armed;
  armed = null;
  if (gesture === null) return;
  if (gesture.screen !== draft.screen) return;
  if (hitRect([gesture.rect], at.x, at.y) < 0) return;
  if (gesture.kind === "tab") {
    selectTab(draft, gesture.index, cues);
    return;
  }
  take(draft, cues);
}

/**
 * The pointer rules, in the order `specs/controls.md` gives them: the hover
 * moves the highlight onto the item it rests in, a press arms the box it lands
 * in, a release inside that same box takes what it armed as `confirm` would (or,
 * on the almanac's tab bar, shows that tab), and the wheel moves the almanac's
 * window. Applied on every frame, after that frame's press edges and before its
 * update. A touch contact reaches the same rules: its landing is the press edge
 * and its lift is the release edge, and it never hovers, because it reports no
 * position out of contact.
 */
export function applyPointer(
  draft: Draft,
  pointer: PointerInput,
  cues: Set<CueName>,
): void {
  if (pointer.at !== null) hover(draft, pointer.at, cues);
  for (const at of pointer.presses) press(draft, at, cues);
  for (const at of pointer.releases) release(draft, at, cues);
  scrollList(draft, pointer.wheel);
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
  /** The pointer, read once for the frame in stage coordinates. */
  pointer: PointerInput;
  /** Toggle the engine's mute bit. */
  toggleMute: () => void;
}

/**
 * One frame over `view`: every edge is answered against the screen the
 * frame began on, the pointer answers the menus after them, `simTime` rises
 * by the delta whatever the screen, and on `playing` the delta becomes
 * ticks. Returns the next state and the cues the frame raised, each at most
 * once, in the order they arose.
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
    // Every edge is read against the screen the frame began on, so once a
    // press has left that screen the frame's remaining edges have nothing to
    // act on: they never act on the screen the press landed in. `mute` is the
    // exception, because it is read on every screen and moves no screen.
    if (action !== "mute" && draft.screen !== arrival) continue;
    handleAction(draft, action, cues, input.toggleMute);
  }
  applyPointer(draft, input.pointer, cues);
  draft.simTime += input.dt;
  consumeTime(draft, input.dt, input.held, cues);
  return { draft, cues: [...cues] };
}
