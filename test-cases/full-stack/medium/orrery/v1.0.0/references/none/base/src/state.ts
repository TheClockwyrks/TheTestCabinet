// Orrery — the game's state, built and restored (specs/state.md, engineless).
//
// This build stands on no engine, so the shape of the state is its own; what
// is fixed over it is the debug surface of specs/instrumentation.md, whose
// every operation is a read or a pose of it. So the state carries exactly what
// those operations read and honor, under the names specs/state.md gives them,
// and `resetState` returns every one of them to its title-screen value.
//
// It is ONE value. Everything the game carries from one frame to the next
// lives in it — the screens, the progress, the open challenge, the machine and
// the hands on it, the run, the pointer, the switches, and the clock — and
// nothing is kept in a module-level variable or a closure. Anything else the
// build holds is derived and rebuilt from these fields, which is what makes a
// reset leave a session indistinguishable from a fresh one.

import { challengeCount } from "./challenges";
import { DEFAULT_SPEED_INDEX, EXTRA_COUNT } from "./constants";
import { cloneMachine } from "./machine";
import type {
  EditorState,
  Metrics,
  Mode,
  OrreryState,
  PartState,
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

/** The whole state at its title-screen values. */
export function createState(): OrreryState {
  return {
    screen: "title",
    mode: "campaign",
    menuIndex: 0,
    titleIndex: 0,
    selectIndex: 0,
    howtoPage: 0,

    unlockedCount: 1,
    campaignSolved: [],
    extrasSolved: [],
    campaignRecords: blankRecords("campaign"),
    extrasRecords: blankRecords("extras"),
    campaignMachines: blankMachines("campaign"),
    extrasMachines: blankMachines("extras"),
    campaignLast: 0,
    extrasLast: 0,

    challenge: null,
    challengeRef: null,
    editor: emptyEditor(),
    sim: null,

    pointer: { x: 0, y: 0, down: false },
    menuPress: null,
    completion: true,
    autoStep: true,
    simTime: 0,
    muted: false,
  };
}

function blankRecords(mode: Mode): (Metrics | null)[] {
  return Array.from({ length: modeLength(mode) }, () => null);
}

function blankMachines(mode: Mode): (PartState[] | null)[] {
  return Array.from({ length: modeLength(mode) }, () => null);
}

/**
 * Restore every declared field to its title-screen value, in place, so the
 * one state value the loop advances and the surface reads survives the reset
 * (specs/instrumentation.md `reset`).
 *
 * Two things are deliberately untouched: `muted`, because the runtime owns
 * muting, and `autoStep`, because a reset inside a stepped scenario leaves the
 * game off the wall clock.
 */
export function resetState(state: OrreryState): void {
  const fresh = createState();
  state.screen = fresh.screen;
  state.mode = fresh.mode;
  state.menuIndex = fresh.menuIndex;
  state.titleIndex = fresh.titleIndex;
  state.selectIndex = fresh.selectIndex;
  state.howtoPage = fresh.howtoPage;

  state.unlockedCount = fresh.unlockedCount;
  state.campaignSolved = fresh.campaignSolved;
  state.extrasSolved = fresh.extrasSolved;
  state.campaignRecords = fresh.campaignRecords;
  state.extrasRecords = fresh.extrasRecords;
  state.campaignMachines = fresh.campaignMachines;
  state.extrasMachines = fresh.extrasMachines;
  state.campaignLast = fresh.campaignLast;
  state.extrasLast = fresh.extrasLast;

  state.challenge = null;
  state.challengeRef = null;
  state.editor = fresh.editor;
  state.sim = null;

  state.pointer = fresh.pointer;
  state.menuPress = fresh.menuPress;
  state.completion = fresh.completion;
  state.simTime = fresh.simTime;
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
