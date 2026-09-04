// Orrery — the state at its title-screen values, built and restored
// (specs/state.md).
//
// `specs/state.md` declares the shape (`src/types.ts`); this is where a state
// of that shape is BUILT. Everything the game carries from one frame to the
// next lives in it — the screens, the progress, the open challenge, the machine
// and the hands on it, the run, the pointer, and the completion switch — and
// the engine holds it by value, replacing it with whatever each transition
// returns. Anything else the build holds is derived and rebuilt from these
// fields, which is what makes a `reset` leave a session indistinguishable from
// a freshly started one (specs/instrumentation.md `reset`).
//
// The accessors below come in two shapes on purpose. Handed a DRAFT they hand
// back the live arrays a transition writes into; handed a finished state they
// hand back the read-only view, so the drawing and the snapshot read the same
// fields without being able to write one.

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
  W,
} from "./types";

/** An editor with nothing placed and no hands on it. */
export function emptyEditor(): W<EditorState> {
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
export function emptySim(productCount: number): W<SimState> {
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
export function createState(): W<OrreryState> {
  return {
    screen: "title",
    mode: "campaign",
    menuIndex: 0,
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
    completion: true,
    simTime: 0,
    muted: false,
  };
}

function blankRecords(mode: Mode): (W<Metrics> | null)[] {
  return Array.from({ length: modeLength(mode) }, () => null);
}

function blankMachines(mode: Mode): (W<PartState>[] | null)[] {
  return Array.from({ length: modeLength(mode) }, () => null);
}

/**
 * Restore every declared field to its title-screen value, in place on the
 * draft the transition is building, so a reset leaves a session
 * indistinguishable from a freshly started one
 * (specs/instrumentation.md `reset`).
 *
 * `muted` is deliberately untouched: the engine owns muting, and the state
 * only mirrors its bit.
 */
export function resetState(state: W<OrreryState>): void {
  const fresh = createState();
  state.screen = fresh.screen;
  state.mode = fresh.mode;
  state.menuIndex = fresh.menuIndex;
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
  state.completion = fresh.completion;
  state.simTime = fresh.simTime;
}

/** That mode's solved indices, the live array. */
export function solvedOf(state: W<OrreryState>, mode: Mode): number[];
export function solvedOf(state: OrreryState, mode: Mode): readonly number[];
export function solvedOf(state: OrreryState, mode: Mode): readonly number[] {
  return mode === "campaign" ? state.campaignSolved : state.extrasSolved;
}

/** That mode's per-challenge records, the live array. */
export function recordsOf(
  state: W<OrreryState>,
  mode: Mode,
): (W<Metrics> | null)[];
export function recordsOf(
  state: OrreryState,
  mode: Mode,
): readonly (Metrics | null)[];
export function recordsOf(
  state: OrreryState,
  mode: Mode,
): readonly (Metrics | null)[] {
  return mode === "campaign" ? state.campaignRecords : state.extrasRecords;
}

/** That mode's per-challenge machine stashes, the live array. */
export function machinesOf(
  state: W<OrreryState>,
  mode: Mode,
): (W<PartState>[] | null)[];
export function machinesOf(
  state: OrreryState,
  mode: Mode,
): readonly (readonly PartState[] | null)[];
export function machinesOf(
  state: OrreryState,
  mode: Mode,
): readonly (readonly PartState[] | null)[] {
  return mode === "campaign" ? state.campaignMachines : state.extrasMachines;
}

/** The row that mode's select screen lands on. */
export function lastOf(state: OrreryState, mode: Mode): number {
  return mode === "campaign" ? state.campaignLast : state.extrasLast;
}

/** Set the row that mode's select screen lands on. */
export function setLastOf(
  state: W<OrreryState>,
  mode: Mode,
  index: number,
): void {
  if (mode === "campaign") state.campaignLast = index;
  else state.extrasLast = index;
}

/** Add an index to a mode's solved set, keeping it ascending and unique. */
export function markSolved(
  state: W<OrreryState>,
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
  state: W<OrreryState>,
  mode: Mode,
  index: number,
): void {
  const solved = solvedOf(state, mode);
  const at = solved.indexOf(index);
  if (at >= 0) solved.splice(at, 1);
}

/** Stash the machine a challenge was left holding (specs/editor.md). */
export function stashMachine(
  state: W<OrreryState>,
  mode: Mode,
  index: number,
  parts: readonly W<PartState>[],
): void {
  const machines = machinesOf(state, mode);
  if (index < 0 || index >= machines.length) return;
  machines[index] = cloneMachine(parts);
}

/** The machine a challenge is holding, or an empty one for a first visit. */
export function stashedMachine(
  state: W<OrreryState>,
  mode: Mode,
  index: number,
): W<PartState>[] {
  const stashed = machinesOf(state, mode)[index];
  return stashed === null || stashed === undefined ? [] : cloneMachine(stashed);
}
