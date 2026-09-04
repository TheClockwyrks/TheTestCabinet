// Orrery — editing the machine: adding, removing, moving, and re-posing a
// placed part (specs/parts.md "Placement rules", specs/instrumentation.md
// "The machine").
//
// One rule runs through all of it: EVERY placement is checked against the
// placement rules of specs/parts.md and refused with the first rule it breaks.
// The challenge's `permitted` list is not consulted, because that is a tray
// rule of specs/editor.md rather than a placement rule — a part the tray does
// not offer is placed here like any other.
//
// A part added while a run is live enters the run at its rest pose holding
// nothing, with a wheel's six fixtures on its spoke hexes; a part removed takes
// its live pose, its grips, and its fixtures off the field with it, and leaves
// what it merely carried resting where it stood.

import {
  createPart,
  findPart,
  writeTapeCell,
  type PartOptions,
} from "./machine";
import { dropMote } from "./motes";
import { carriesTape, isArmKind, placementFailure } from "./parts";
import { raiseFixtures } from "./sim";
import type {
  Challenge,
  Instruction,
  OrreryState,
  PartKind,
  PartState,
  SolutionPart,
  W,
} from "./types";

/** Raise the surface's refusal for a placement, naming the rule it broke. */
function refuse(operation: string, reason: string): never {
  throw new Error(`${operation}: ${reason}`);
}

/** The part `id` names, or the surface's refusal that nothing carries it. */
export function requirePart(
  state: W<OrreryState>,
  operation: string,
  id: unknown,
): W<PartState> {
  if (typeof id !== "number" || !Number.isInteger(id)) {
    refuse(operation, `part must be a part id; got ${String(id)}`);
  }
  const part = findPart(state.editor.parts, id);
  if (part === null) refuse(operation, `no part carries the id ${id}`);
  return part;
}

/**
 * Place one part, checked against the machine as it stands. The new part's
 * `id` is the id of the last entry of `editor.parts` afterwards.
 */
export function addPart(
  state: W<OrreryState>,
  operation: string,
  kind: PartKind,
  q: number,
  r: number,
  rotation: number,
  options: PartOptions = {},
): W<PartState> {
  const candidate = createPart(
    state.editor.nextId,
    kind,
    q,
    r,
    rotation,
    options,
  );
  const failure = placementFailure(
    candidate,
    state.editor.parts,
    state.challenge,
  );
  if (failure !== null) refuse(operation, failure);
  state.editor.nextId += 1;
  state.editor.parts.push(candidate);
  enterRun(state, candidate);
  return candidate;
}

/**
 * Place one part when the placement rules allow it, and report `null` when
 * they do not. This is the editor's door onto `addPart`: specs/editor.md
 * refuses an illegal placement silently, where the debug surface raises the
 * rule it broke.
 */
export function tryAddPart(
  state: W<OrreryState>,
  kind: PartKind,
  q: number,
  r: number,
  rotation: number,
  options: PartOptions = {},
): W<PartState> | null {
  const candidate = createPart(
    state.editor.nextId,
    kind,
    q,
    r,
    rotation,
    options,
  );
  if (
    placementFailure(candidate, state.editor.parts, state.challenge) !== null
  ) {
    return null;
  }
  state.editor.nextId += 1;
  state.editor.parts.push(candidate);
  enterRun(state, candidate);
  return candidate;
}

/** A part added while a run is live enters it at its rest pose, holding nothing. */
export function enterRun(state: W<OrreryState>, part: W<PartState>): void {
  const sim = state.sim;
  if (sim === null) return;
  if (!isArmKind(part.kind) && part.kind !== "wheel") return;
  sim.poses.push({
    part: part.id,
    rotation: part.rotation,
    length: part.length,
    cell: { q: part.q, r: part.r },
  });
  if (part.kind === "wheel") raiseFixtures(sim, part);
}

/** A part removed takes its live pose, its grips, and its fixtures with it. */
export function leaveRun(state: W<OrreryState>, part: W<PartState>): void {
  const sim = state.sim;
  if (sim === null) return;
  sim.poses = sim.poses.filter((pose) => pose.part !== part.id);
  sim.grips = sim.grips.filter((grip) => grip.part !== part.id);
  for (const mote of [...sim.motes]) {
    if (mote.wheel === part.id) dropMote(sim, mote.id);
  }
}

/**
 * Remove one placed part, discarding its tape and its tape-panel row, and
 * clearing a selection or a cursor the removal invalidates.
 */
export function removePart(state: W<OrreryState>, part: W<PartState>): void {
  const editor = state.editor;
  editor.parts = editor.parts.filter((entry) => entry.id !== part.id);
  if (editor.selected === part.id) editor.selected = null;
  if (editor.cursor?.part === part.id) editor.cursor = null;
  if (
    editor.drag !== null &&
    editor.drag.kind !== "place" &&
    editor.drag.part === part.id
  ) {
    editor.drag = null;
  }
  leaveRun(state, part);
}

/**
 * The machine a solution document describes, built by applying its parts in
 * the order `parts` lists them and checking each against the machine built so
 * far. The first part that breaks a placement rule refuses the WHOLE document,
 * so a refused load leaves the editor exactly as it stood rather than holding
 * half a machine.
 */
export function machineFromSolution(
  operation: string,
  document: readonly SolutionPart[],
  challenge: W<Challenge> | null,
  firstId: number,
): W<PartState>[] {
  const built: W<PartState>[] = [];
  document.forEach((entry, index) => {
    const anchor = entry.cells?.[0] ?? { q: entry.q ?? 0, r: entry.r ?? 0 };
    const part = createPart(
      firstId + index,
      entry.kind,
      anchor.q,
      anchor.r,
      entry.rotation ?? 0,
      {
        length: entry.length,
        cells: entry.cells,
        closed: entry.closed,
        index: entry.index,
        tape: entry.tape,
      },
    );
    const failure = placementFailure(part, built, challenge);
    if (failure !== null) refuse(operation, `parts[${index}]: ${failure}`);
    built.push(part);
  });
  return built;
}

/** Replace the machine with one already built, entering a live run with it. */
export function loadMachine(
  state: W<OrreryState>,
  machine: W<PartState>[],
): void {
  clearMachine(state);
  for (const part of machine) {
    state.editor.parts.push(part);
    state.editor.nextId = Math.max(state.editor.nextId, part.id + 1);
    enterRun(state, part);
  }
}

/** Remove every placed part, and clear the hands on the machine. */
export function clearMachine(state: W<OrreryState>): void {
  for (const part of [...state.editor.parts]) removePart(state, part);
  const editor = state.editor;
  editor.parts = [];
  editor.selected = null;
  editor.cursor = null;
  editor.drag = null;
  editor.undo = [];
  editor.redo = [];
}

/**
 * Apply a change to one part, and report the first placement rule the result
 * breaks. A refused change writes nothing, so the machine is left exactly as
 * it stood.
 */
function reposeFailure(
  state: W<OrreryState>,
  part: W<PartState>,
  change: (draft: W<PartState>) => void,
): string | null {
  const draft: W<PartState> = {
    ...part,
    cells: part.cells === null ? null : part.cells.map((cell) => ({ ...cell })),
    tape: part.tape === null ? null : [...part.tape],
  };
  change(draft);
  const others = state.editor.parts.filter((entry) => entry.id !== part.id);
  const failure = placementFailure(draft, others, state.challenge);
  if (failure !== null) return failure;
  const at = state.editor.parts.indexOf(part);
  state.editor.parts[at] = draft;
  return null;
}

/**
 * Apply a change to one part, leaving it exactly as it stands when the result
 * would be illegal, and report whether it was applied. This is the editor's
 * door: specs/editor.md refuses an illegal edit silently, where the debug
 * surface raises the rule it broke.
 */
export function tryRepose(
  state: W<OrreryState>,
  part: W<PartState>,
  change: (draft: W<PartState>) => void,
): boolean {
  return reposeFailure(state, part, change) === null;
}

/** Apply a change to one part, refusing it when the result is illegal. */
function repose(
  state: W<OrreryState>,
  operation: string,
  part: W<PartState>,
  change: (draft: W<PartState>) => void,
): void {
  const failure = reposeFailure(state, part, change);
  if (failure !== null) refuse(operation, failure);
}

/** Set a part's rest rotation, `0` to `5`. */
export function setPartRotation(
  state: W<OrreryState>,
  operation: string,
  part: W<PartState>,
  rotation: number,
): void {
  repose(state, operation, part, (draft) => {
    draft.rotation = rotation;
  });
}

/** Set an arm or piston's rest length, `ARM_MIN_LEN` to `ARM_MAX_LEN`. */
export function setPartLength(
  state: W<OrreryState>,
  operation: string,
  part: W<PartState>,
  length: number,
): void {
  if (!isArmKind(part.kind)) {
    refuse(operation, `a ${part.kind} carries no length to set`);
  }
  repose(state, operation, part, (draft) => {
    draft.length = length;
  });
}

/** Translate the whole part, a track's path included, onto a new anchor. */
export function movePart(
  state: W<OrreryState>,
  operation: string,
  part: W<PartState>,
  q: number,
  r: number,
): void {
  const dq = q - part.q;
  const dr = r - part.r;
  repose(state, operation, part, (draft) => {
    draft.q = q;
    draft.r = r;
    if (draft.cells !== null) {
      draft.cells = draft.cells.map((cell) => ({
        q: cell.q + dq,
        r: cell.r + dr,
      }));
    }
  });
}

/** Append one cell to a track's path, at its `last` end. */
export function extendTrack(
  state: W<OrreryState>,
  operation: string,
  part: W<PartState>,
  q: number,
  r: number,
): void {
  if (part.kind !== "track")
    refuse(operation, `a ${part.kind} carries no path`);
  if (part.closed === true)
    refuse(operation, "a closed track takes no more cells");
  repose(state, operation, part, (draft) => {
    draft.cells = [...(draft.cells ?? []), { q, r }];
  });
}

/** Join a track's last cell to its first, closing the path into a loop. */
export function closeTrack(
  state: W<OrreryState>,
  operation: string,
  part: W<PartState>,
): void {
  if (part.kind !== "track")
    refuse(operation, `a ${part.kind} carries no path`);
  repose(state, operation, part, (draft) => {
    draft.closed = true;
  });
}

/** Write one instruction, or a blank, at one column of a part's tape. */
export function setTapeCell(
  state: W<OrreryState>,
  operation: string,
  part: W<PartState>,
  col: number,
  instruction: Instruction | null,
): void {
  if (!carriesTape(part.kind)) {
    refuse(operation, `a ${part.kind} carries no tape`);
  }
  const at = state.editor.parts.indexOf(part);
  state.editor.parts[at] = {
    ...part,
    tape: writeTapeCell(part.tape, col, instruction),
  };
}
