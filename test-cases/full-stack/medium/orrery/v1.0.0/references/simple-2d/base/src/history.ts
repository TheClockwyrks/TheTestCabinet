// Orrery — undo and redo over machine snapshots (specs/editor.md "Undo and
// redo").
//
// An entry is A WHOLE MACHINE as it stood before an edit: the parts with their
// poses, paths, and tapes. Nothing else goes in — selection, cursor, focus, and
// drags are hands on the machine rather than part of it — so undoing a rotation
// and undoing a track lay are the same operation, and no edit needs an inverse
// written for it.
//
// One rule decides whether an edit is committed at all: an edit that changes
// nothing commits nothing. Writing the instruction a cell already holds, a
// release on the hex a drag began at, a refused placement, and a lay that
// appended and then backtracked to where it started all leave the machine
// equal to the entry that would have been pushed, so none of them pushes one.
//
// The history holds every edit of the visit with no bound on its depth, and it
// is not part of the per-challenge stash: leaving a challenge keeps the
// machine and drops the history with the visit.

import { cloneMachine } from "./machine";
import type { OrreryState, PartState, W } from "./types";

/** Whether two placed parts hold exactly the same facts. */
function partsEqual(a: W<PartState>, b: W<PartState>): boolean {
  if (
    a.id !== b.id ||
    a.kind !== b.kind ||
    a.q !== b.q ||
    a.r !== b.r ||
    a.rotation !== b.rotation ||
    a.length !== b.length ||
    a.closed !== b.closed ||
    a.index !== b.index
  ) {
    return false;
  }
  if ((a.cells === null) !== (b.cells === null)) return false;
  if (a.cells !== null && b.cells !== null) {
    if (a.cells.length !== b.cells.length) return false;
    for (let i = 0; i < a.cells.length; i += 1) {
      if (a.cells[i].q !== b.cells[i].q || a.cells[i].r !== b.cells[i].r) {
        return false;
      }
    }
  }
  if ((a.tape === null) !== (b.tape === null)) return false;
  if (a.tape !== null && b.tape !== null) {
    if (a.tape.length !== b.tape.length) return false;
    for (let i = 0; i < a.tape.length; i += 1) {
      if (a.tape[i] !== b.tape[i]) return false;
    }
  }
  return true;
}

/** Whether two machines hold the same parts, in the same placement order. */
export function machinesEqual(
  a: readonly W<PartState>[],
  b: readonly W<PartState>[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((part, index) => partsEqual(part, b[index]));
}

/** The machine as it stands, copied, to be held as an entry if an edit lands. */
export function beginEdit(state: W<OrreryState>): W<PartState>[] {
  return cloneMachine(state.editor.parts);
}

/**
 * Close an edit begun with `beginEdit`. An edit that changed the machine
 * pushes `before` onto the undo history and clears the redo side; one that
 * changed nothing pushes nothing. Returns whether anything was committed.
 */
export function commitEdit(
  state: W<OrreryState>,
  before: readonly W<PartState>[],
): boolean {
  if (machinesEqual(state.editor.parts, before)) return false;
  state.editor.undo.push(cloneMachine(before));
  state.editor.redo = [];
  return true;
}

/**
 * Clear a selection or a cursor the machine no longer holds a part for
 * (specs/editor.md: an edit, undo, or redo that removes the selected part
 * clears the selection, and one that removes the cursor's arm clears the
 * cursor).
 */
export function reconcileHands(state: W<OrreryState>): void {
  const editor = state.editor;
  const holds = (id: number): boolean =>
    editor.parts.some((part) => part.id === id);
  if (editor.selected !== null && !holds(editor.selected)) {
    editor.selected = null;
  }
  if (editor.cursor !== null && !holds(editor.cursor.part)) {
    editor.cursor = null;
  }
}

/** Whether the editor is in a state that answers `undo` and `redo` at all. */
function editable(state: W<OrreryState>): boolean {
  return state.screen === "editor" && state.sim === null;
}

/** Restore the machine from the latest entry, moving that edit onto redo. */
export function undoEdit(state: W<OrreryState>): void {
  if (!editable(state)) return;
  const editor = state.editor;
  const entry = editor.undo.pop();
  if (entry === undefined) return;
  editor.redo.push(cloneMachine(editor.parts));
  editor.parts = entry;
  reconcileHands(state);
}

/** Re-apply the latest undone edit, moving it back onto the undo side. */
export function redoEdit(state: W<OrreryState>): void {
  if (!editable(state)) return;
  const editor = state.editor;
  const entry = editor.redo.pop();
  if (entry === undefined) return;
  editor.undo.push(cloneMachine(editor.parts));
  editor.parts = entry;
  reconcileHands(state);
}
