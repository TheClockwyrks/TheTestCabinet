// Orrery — the world's game state (specs/state.md).
//
// `OrreryState` below is the class `specs/state.md` declares: the game mode
// names it as its `gameStateClass`, so the engine builds ONE instance of it
// when the world opens and `engine.world.state` is that instance. Orrery runs
// in one level for the whole session and every screen is a value of `screen`,
// so this object is built once and lives until the page closes.
//
// The framework's states are LIVE: a tick, a controller, and a debug pose all
// write the fields they advance in place. Each field initializer here is that
// field's title-screen value, and `resetState` restores exactly those, so a
// reset leaves a session indistinguishable from a fresh one.
//
// It is ONE value. Everything the game carries from one frame to the next lives
// in it — the screens, the progress, the open challenge, the machine and the
// hands on it, the run, the pointer, the switches, and the clock. Anything an
// actor, a component, or a controller holds of its own is derived and rebuilt
// from these fields.

import { GameState } from "@clockwyrks/structured-2d";
import type { World } from "@clockwyrks/structured-2d";
import { challengeCount } from "./challenges";
import { DEFAULT_SPEED_INDEX, EXTRA_COUNT } from "./constants";
import { cloneMachine } from "./machine";
import type {
  Challenge,
  EditorState,
  Metrics,
  Mode,
  PartState,
  PointerState,
  Screen,
  SimState,
} from "./types";

/** An editor with nothing placed and no hands on it. */
export function emptyEditor(): EditorState {
  return {
    parts: [],
    nextId: 1,
    selected: null,
    focus: "field",
    cursor: null,
    drag: null,
    undo: [],
    redo: [],
  };
}

/** A fresh run of one challenge's products, before the settle. */
export function emptySim(productCount: number): SimState {
  return {
    status: "running",
    cycle: 0,
    fraction: 0,
    speed: DEFAULT_SPEED_INDEX,
    motes: [],
    nextMoteId: 1,
    filaments: [],
    poses: [],
    grips: [],
    tallies: Array.from({ length: productCount }, () => 0),
    areaHexes: [],
    fault: null,
    metrics: null,
    pending: null,
  };
}

/** How many entries a mode's per-challenge arrays hold. */
export function modeLength(mode: Mode): number {
  return mode === "extras" ? EXTRA_COUNT : challengeCount("campaign");
}

function blankRecords(mode: Mode): (Metrics | null)[] {
  return Array.from({ length: modeLength(mode) }, () => null);
}

function blankMachines(mode: Mode): (PartState[] | null)[] {
  return Array.from({ length: modeLength(mode) }, () => null);
}

/**
 * The whole of Orrery's state, as `specs/state.md` declares it: the world's
 * game state, built by the engine from the mode's `gameStateClass` when the
 * world opens.
 */
export class OrreryState extends GameState {
  screen: Screen = "title";
  mode: Mode = "campaign";
  menuIndex = 0;
  titleIndex = 0;
  selectIndex = 0;
  howtoPage = 0;

  unlockedCount = 1;
  campaignSolved: number[] = [];
  extrasSolved: number[] = [];
  campaignRecords: (Metrics | null)[] = blankRecords("campaign");
  extrasRecords: (Metrics | null)[] = blankRecords("extras");
  campaignMachines: (PartState[] | null)[] = blankMachines("campaign");
  extrasMachines: (PartState[] | null)[] = blankMachines("extras");
  campaignLast = 0;
  extrasLast = 0;

  challenge: Challenge | null = null;
  challengeRef: { mode: Mode; index: number } | null = null;
  editor: EditorState = emptyEditor();
  sim: SimState | null = null;

  pointer: PointerState = { x: 0, y: 0, down: false };
  /**
   * The menu item a live press landed in, and `null` when the press landed
   * outside every item or none is live (specs/ui.md "Pointer and touch").
   *
   * "Taking an item requires both of its edges inside that item's region", and
   * the press position is gone by the time the release arrives — `pointer`
   * carries where the pointer IS, not where it went down — so the index the
   * press landed in is carried here, in the one state, rather than in a
   * module-level variable, a closure, or a field of the controller.
   */
  menuPress: number | null = null;
  completion = true;
  simTime = 0;
  muted = false;
}

/**
 * The open world's game state, typed. The mode's `gameStateClass` is
 * `OrreryState`, so this is the one instance the engine built for the world.
 */
export function orreryState(world: World): OrreryState {
  const state = world.state;
  if (!(state instanceof OrreryState)) {
    throw new Error("Orrery: the world's game state is not an OrreryState");
  }
  return state;
}

/**
 * Restore every declared field to its title-screen value, in place, so the one
 * state the world holds and the surface reads survives the reset
 * (specs/instrumentation.md `reset`).
 *
 * `muted` is deliberately untouched: the engine owns muting.
 */
export function resetState(state: OrreryState): void {
  state.screen = "title";
  state.mode = "campaign";
  state.menuIndex = 0;
  state.titleIndex = 0;
  state.selectIndex = 0;
  state.howtoPage = 0;

  state.unlockedCount = 1;
  state.campaignSolved = [];
  state.extrasSolved = [];
  state.campaignRecords = blankRecords("campaign");
  state.extrasRecords = blankRecords("extras");
  state.campaignMachines = blankMachines("campaign");
  state.extrasMachines = blankMachines("extras");
  state.campaignLast = 0;
  state.extrasLast = 0;

  state.challenge = null;
  state.challengeRef = null;
  state.editor = emptyEditor();
  state.sim = null;

  state.pointer = { x: 0, y: 0, down: false };
  state.menuPress = null;
  state.completion = true;
  state.simTime = 0;
}

/** That mode's solved indices, the live array. */
export function solvedOf(state: OrreryState, mode: Mode): number[] {
  return mode === "campaign" ? state.campaignSolved : state.extrasSolved;
}

/** That mode's per-challenge records, the live array. */
export function recordsOf(state: OrreryState, mode: Mode): (Metrics | null)[] {
  return mode === "campaign" ? state.campaignRecords : state.extrasRecords;
}

/** That mode's per-challenge machine stashes, the live array. */
export function machinesOf(
  state: OrreryState,
  mode: Mode,
): (PartState[] | null)[] {
  return mode === "campaign" ? state.campaignMachines : state.extrasMachines;
}

/** The row that mode's select screen lands on. */
export function lastOf(state: OrreryState, mode: Mode): number {
  return mode === "campaign" ? state.campaignLast : state.extrasLast;
}

/** Set the row that mode's select screen lands on. */
export function setLastOf(state: OrreryState, mode: Mode, index: number): void {
  if (mode === "campaign") state.campaignLast = index;
  else state.extrasLast = index;
}

/** Add an index to a mode's solved set, keeping it ascending and unique. */
export function markSolved(
  state: OrreryState,
  mode: Mode,
  index: number,
): void {
  const solved = solvedOf(state, mode);
  if (!solved.includes(index)) {
    solved.push(index);
    solved.sort((a, b) => a - b);
  }
}

/** Remove an index from a mode's solved set. */
export function clearSolved(
  state: OrreryState,
  mode: Mode,
  index: number,
): void {
  const solved = solvedOf(state, mode);
  const at = solved.indexOf(index);
  if (at >= 0) solved.splice(at, 1);
}

/** Stash the machine a challenge was left holding (specs/editor.md). */
export function stashMachine(
  state: OrreryState,
  mode: Mode,
  index: number,
  parts: readonly PartState[],
): void {
  const machines = machinesOf(state, mode);
  if (index < 0 || index >= machines.length) return;
  machines[index] = cloneMachine(parts);
}

/** The machine a challenge is holding, or an empty one for a first visit. */
export function stashedMachine(
  state: OrreryState,
  mode: Mode,
  index: number,
): PartState[] {
  const stashed = machinesOf(state, mode)[index];
  return stashed === null || stashed === undefined ? [] : cloneMachine(stashed);
}
