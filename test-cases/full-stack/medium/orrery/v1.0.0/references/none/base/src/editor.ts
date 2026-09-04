// Orrery — the editor screen's hands: what a pointer sample and an editing key
// do to the machine (specs/editor.md, specs/controls.md).
//
// Two entry points, and every edit runs through one of them: `applyPointerSample`
// for a press, a move, and a release, and `applyEditorAction` for the focus-routed
// keys. The debug surface's pointer operations feed the first and the runtime's
// key edges feed the second, so a machine built from code and one built by hand
// take exactly the same path — targeting, selection, drags, lays, and the focus
// rule included.
//
// Three shapes of drag do all the placing and moving, and each begins at a
// press and ends at its release. A gesture is ONE edit: the machine as it stood
// at the press is held on the drag, and the release commits that entry if the
// gesture changed anything at all. That is what makes a lay of three cells one
// undo entry rather than three, and a release on the hex the press grabbed no
// entry at all.
//
// Every edit is checked against the placement rules of specs/parts.md and
// refused SILENTLY: the editor leaves the part exactly as it stands where the
// debug surface would raise the rule that was broken.

import {
  ARM_MAX_LEN,
  ARM_MIN_LEN,
  CLOSED_TRACK_MIN_CELLS,
  CUES,
  INSTRUCTION_ACTIONS,
  type Action,
  type Cue,
} from "./constants";
import { beginEdit, commitEdit, redoEdit, undoEdit } from "./history";
import { adjacent, hexAt, sameHex, wrapDir } from "./hex";
import { findPart, tapeRows, trimTape, writeTapeCell } from "./machine";
import { removePart, tryAddPart, tryRepose } from "./machineops";
import { repeatExpansion, resetExpansion, type TrackPath } from "./macros";
import {
  carriesTape,
  isArmKind,
  lengthInBounds,
  mountedTrack,
  partClass,
  partHexes,
} from "./parts";
import type { PointerSample } from "./pointer";
import { insideTapePanel, regionAt } from "./regions";
import { tapeHitAt } from "./tapepanel";
import { entrySpent, trayEntries, trayEntryIndexAt } from "./tray";
import type {
  DragState,
  Hex,
  Instruction,
  OrreryState,
  PartState,
  TapeCell,
} from "./types";

export { insideTapePanel };

/** What the editor needs of the game around it: the state, and the cue queue. */
export interface EditorHost {
  /** The whole of the game's state. */
  readonly state: OrreryState;
  /** Ask for a cue on this frame. Played once, however often it is asked. */
  cue(cue: Cue): void;
}

/** The actions that act on a live drag's ghost rather than on the machine. */
const GHOST_ACTIONS: readonly Action[] = [
  "part-cw",
  "part-ccw",
  "part-grow",
  "part-shrink",
];

/** The actions the field focus routes to the selected part. */
const FIELD_ACTIONS: readonly Action[] = [...GHOST_ACTIONS, "part-delete"];

// ---------------------------------------------------------------------------
// The pointer
// ---------------------------------------------------------------------------

/**
 * Resolve one pointer sample against the editor, in the order the samples
 * arrived. A press sets the focus wherever it lands, and while a run is active
 * that is all any sample does (specs/editor.md "Running the machine").
 */
export function applyPointerSample(
  host: EditorHost,
  sample: PointerSample,
): void {
  const state = host.state;
  if (state.screen !== "editor") return;
  if (sample.type === "down") {
    state.editor.focus = insideTapePanel(sample.x, sample.y) ? "tape" : "field";
  }
  if (state.sim !== null || state.challenge === null) return;
  if (sample.type === "down") pressAt(host, sample.x, sample.y);
  else if (sample.type === "move") moveTo(host, sample.x, sample.y);
  else release(host);
}

/** A press, answered by the region it landed in. */
function pressAt(host: EditorHost, x: number, y: number): void {
  if (host.state.editor.drag !== null) return;
  switch (regionAt(x, y)) {
    case "tray":
      pressTray(host, x, y);
      return;
    case "field":
      pressField(host, x, y);
      return;
    case "tape":
      pressTape(host, x, y);
      return;
    default:
      // The heading and the readout are display only, and a press off the
      // stage lands in no region at all.
      return;
  }
}

/** A press in the tray: entry `k` begins placing that part. */
function pressTray(host: EditorHost, x: number, y: number): void {
  const state = host.state;
  const entries = trayEntries(state.challenge);
  const at = trayEntryIndexAt(x, y, entries.length);
  if (at === null) return;
  const entry = entries[at];
  if (entrySpent(entry, state.editor.parts)) return;
  state.editor.drag = {
    kind: "place",
    part: entry.kind,
    index: entry.index,
    rotation: 0,
    length: ARM_MIN_LEN,
    at: hexAt(x, y),
    before: beginEdit(state),
  };
}

/** A press on the field: it selects, and it begins a move or a lay. */
function pressField(host: EditorHost, x: number, y: number): void {
  const state = host.state;
  const cell = hexAt(x, y);
  const part = cell === null ? null : topmostPartAt(state, cell);
  if (cell === null || part === null) {
    state.editor.selected = null;
    return;
  }
  selectPart(state, part);
  const end = layEndFor(part, cell);
  state.editor.drag =
    end === null
      ? {
          kind: "move",
          part: part.id,
          from: { q: cell.q, r: cell.r },
          at: { q: cell.q, r: cell.r },
          rotation: part.rotation,
          length: part.length,
          before: beginEdit(state),
        }
      : { kind: "lay", part: part.id, end, before: beginEdit(state) };
}

/** A press in the tape panel: it points the cursor and nothing else. */
function pressTape(host: EditorHost, x: number, y: number): void {
  const editor = host.state.editor;
  const hit = tapeHitAt(editor.parts, editor.cursor, x, y);
  if (hit === null) return;
  editor.cursor = { part: hit.part, col: hit.col };
}

/**
 * The part a press on `cell` takes: an arm or wheel anchored there, else a
 * track with that cell, else the sigil whose footprint covers it
 * (specs/editor.md "Selection on the field").
 */
export function topmostPartAt(state: OrreryState, cell: Hex): PartState | null {
  let mechanism: PartState | null = null;
  let track: PartState | null = null;
  let engraved: PartState | null = null;
  for (const part of state.editor.parts) {
    const cls = partClass(part.kind);
    if (cls === "arm" || cls === "wheel") {
      if (sameHex({ q: part.q, r: part.r }, cell)) mechanism ??= part;
    } else if (cls === "track") {
      if ((part.cells ?? []).some((entry) => sameHex(entry, cell))) {
        track ??= part;
      }
    } else if (
      partHexes(part, state.challenge).some((entry) => sameHex(entry, cell))
    ) {
      engraved ??= part;
    }
  }
  return mechanism ?? track ?? engraved;
}

/** Select a part, pointing the tape cursor at its row when it carries one. */
function selectPart(state: OrreryState, part: PartState): void {
  state.editor.selected = part.id;
  if (carriesTape(part.kind)) state.editor.cursor = { part: part.id, col: 0 };
}

/**
 * Which end of an open track a press on `cell` lays from, and `null` when the
 * press begins a move instead. A one-cell track lays from its `last` end, and
 * a closed track has no end to lay from.
 */
function layEndFor(part: PartState, cell: Hex): "first" | "last" | null {
  if (part.kind !== "track" || part.closed === true) return null;
  const cells = part.cells ?? [];
  if (cells.length === 0) return null;
  if (sameHex(cells[cells.length - 1], cell)) return "last";
  if (sameHex(cells[0], cell)) return "first";
  return null;
}

/** A move: it retargets the live drag, hex by hex. */
function moveTo(host: EditorHost, x: number, y: number): void {
  const drag = host.state.editor.drag;
  if (drag === null) return;
  if (drag.kind === "lay") {
    layTo(host, drag, x, y);
    return;
  }
  drag.at = hexAt(x, y);
}

/**
 * One pointer position resolved against a live lay (specs/editor.md "Laying
 * track"). Removal outranks closing, so a path of two cells is shortened
 * rather than closed, and closing ends the lay at once.
 */
function layTo(
  host: EditorHost,
  drag: Extract<DragState, { kind: "lay" }>,
  x: number,
  y: number,
): void {
  const state = host.state;
  const cell = hexAt(x, y);
  if (cell === null) return;
  const part = findPart(state.editor.parts, drag.part);
  if (part === null || part.kind !== "track") return;
  const cells = part.cells ?? [];
  const count = cells.length;
  if (count === 0) return;
  const live = drag.end === "first" ? cells[0] : cells[count - 1];
  if (sameHex(cell, live)) return;

  // Removal outranks closing.
  const behind =
    count >= 2 ? (drag.end === "first" ? cells[1] : cells[count - 2]) : null;
  if (behind !== null && sameHex(cell, behind)) {
    setTrackPath(
      state,
      part,
      drag.end === "first" ? cells.slice(1) : cells.slice(0, count - 1),
    );
    return;
  }

  const other = drag.end === "first" ? cells[count - 1] : cells[0];
  if (count >= CLOSED_TRACK_MIN_CELLS && sameHex(cell, other)) {
    if (
      tryRepose(state, part, (draft) => {
        draft.closed = true;
      })
    ) {
      endLay(state, drag);
    }
    return;
  }

  if (!adjacent(cell, live)) return;
  setTrackPath(
    state,
    part,
    drag.end === "first" ? [cell, ...cells] : [...cells, cell],
  );
}

/** Lay a track's path anew, refusing a path the placement rules break. */
function setTrackPath(
  state: OrreryState,
  part: PartState,
  cells: readonly Hex[],
): boolean {
  if (cells.length === 0) return false;
  return tryRepose(state, part, (draft) => {
    draft.cells = cells.map((cell) => ({ q: cell.q, r: cell.r }));
    draft.q = cells[0].q;
    draft.r = cells[0].r;
  });
}

/** End a lay, committing the whole gesture as one entry. */
function endLay(
  state: OrreryState,
  drag: Extract<DragState, { kind: "lay" }>,
): void {
  commitEdit(state, drag.before);
  state.editor.drag = null;
}

/** A release: every drag ends here, and each shape commits its own way. */
function release(host: EditorHost): void {
  const state = host.state;
  const drag = state.editor.drag;
  if (drag === null) return;
  state.editor.drag = null;
  if (drag.kind === "place") commitPlace(host, drag);
  else if (drag.kind === "move") commitMove(host, drag);
  else commitEdit(state, drag.before);
}

/** A place drag's release: it places on a legal hex and nothing anywhere else. */
function commitPlace(
  host: EditorHost,
  drag: Extract<DragState, { kind: "place" }>,
): void {
  const state = host.state;
  const at = drag.at;
  if (at === null) return;
  const placed = tryAddPart(state, drag.part, at.q, at.r, drag.rotation, {
    length: drag.length,
    index: drag.index ?? undefined,
  });
  if (placed === null) return;
  selectPart(state, placed);
  commitEdit(state, drag.before);
  host.cue(CUES.place);
}

/**
 * A move drag's release: the part translates by the drag's offset when the
 * result is legal, and stays where it stands when it is not. Either way it
 * keeps the ghost's rotation and length, and stays selected.
 */
function commitMove(
  host: EditorHost,
  drag: Extract<DragState, { kind: "move" }>,
): void {
  const state = host.state;
  const part = findPart(state.editor.parts, drag.part);
  if (part === null) return;
  const at = drag.at;
  const moved = at !== null && !sameHex(at, drag.from);
  const translated =
    moved &&
    applyGhost(state, part, at.q - drag.from.q, at.r - drag.from.r, drag);
  if (!translated) applyGhost(state, part, 0, 0, drag);
  commitEdit(state, drag.before);
  if (translated) host.cue(CUES.place);
}

/** Translate a part by an offset and pose it as the ghost stands. */
function applyGhost(
  state: OrreryState,
  part: PartState,
  dq: number,
  dr: number,
  drag: Extract<DragState, { kind: "move" }>,
): boolean {
  return tryRepose(state, part, (draft) => {
    draft.q = part.q + dq;
    draft.r = part.r + dr;
    if (draft.cells !== null) {
      draft.cells = draft.cells.map((cell) => ({
        q: cell.q + dq,
        r: cell.r + dr,
      }));
    }
    if (turnable(part)) draft.rotation = drag.rotation;
    if (isArmKind(part.kind)) draft.length = drag.length;
  });
}

/** Whether the rotation verbs turn this part: an arm, a wheel, or a sigil. */
function turnable(part: PartState): boolean {
  return part.kind !== "track";
}

// ---------------------------------------------------------------------------
// The keys
// ---------------------------------------------------------------------------

/**
 * Resolve one editing action against the machine. The run controls and the
 * menus are the game's; this is the half specs/controls.md routes by focus.
 */
export function applyEditorAction(host: EditorHost, action: Action): void {
  const state = host.state;
  if (state.screen !== "editor" || state.sim !== null) return;
  const editor = state.editor;
  if (editor.drag !== null) {
    if (GHOST_ACTIONS.includes(action)) ghostAction(state, editor.drag, action);
    return;
  }
  if (action === "undo") {
    undoEdit(state);
    return;
  }
  if (action === "redo") {
    redoEdit(state);
    return;
  }
  if (FIELD_ACTIONS.includes(action)) {
    if (editor.focus === "field") partAction(host, action);
    return;
  }
  if (editor.focus === "tape") tapeAction(state, action);
}

/** The four ghost verbs, which act on the drag rather than on the machine. */
function ghostAction(
  state: OrreryState,
  drag: DragState,
  action: Action,
): void {
  if (drag.kind === "lay") return;
  if (action === "part-cw" || action === "part-ccw") {
    drag.rotation = wrapDir(drag.rotation + (action === "part-cw" ? 1 : -1));
    return;
  }
  const kind =
    drag.kind === "place"
      ? drag.part
      : (findPart(state.editor.parts, drag.part)?.kind ?? null);
  if (kind === null || !isArmKind(kind)) return;
  const length = drag.length + (action === "part-grow" ? 1 : -1);
  if (lengthInBounds(length)) drag.length = length;
}

/** The field-focus verbs, which act on the selected part. */
function partAction(host: EditorHost, action: Action): void {
  const state = host.state;
  const selected = state.editor.selected;
  const part =
    selected === null ? null : findPart(state.editor.parts, selected);
  if (part === null) return;
  const before = beginEdit(state);
  if (action === "part-delete") {
    removePart(state, part);
    commitEdit(state, before);
    host.cue(CUES.erase);
    return;
  }
  if (action === "part-cw" || action === "part-ccw") {
    if (!turnable(part)) return;
    const rotation = wrapDir(part.rotation + (action === "part-cw" ? 1 : -1));
    if (
      tryRepose(state, part, (draft) => {
        draft.rotation = rotation;
      })
    ) {
      commitEdit(state, before);
    }
    return;
  }
  if (!isArmKind(part.kind)) return;
  const length = part.length + (action === "part-grow" ? 1 : -1);
  if (length < ARM_MIN_LEN || length > ARM_MAX_LEN) return;
  if (
    tryRepose(state, part, (draft) => {
      draft.length = length;
    })
  ) {
    commitEdit(state, before);
  }
}

/** The tape-focus verbs, which edit at the cursor. */
function tapeAction(state: OrreryState, action: Action): void {
  const editor = state.editor;
  const cursor = editor.cursor;
  if (cursor === null) return;
  const part = findPart(editor.parts, cursor.part);
  if (part === null || part.tape === null) return;
  switch (action) {
    case "up":
    case "down":
      moveCursorRow(state, action === "down");
      return;
    case "left":
      editor.cursor = { part: cursor.part, col: Math.max(0, cursor.col - 1) };
      return;
    case "right":
      editor.cursor = { part: cursor.part, col: cursor.col + 1 };
      return;
    case "ins-blank":
      writeCell(state, part, cursor.col, null);
      return;
    case "ins-erase":
      if (cursor.col === 0) return;
      writeCell(state, part, cursor.col - 1, null);
      editor.cursor = { part: cursor.part, col: cursor.col - 1 };
      return;
    case "ins-reset":
      writeCells(
        state,
        part,
        cursor.col,
        resetExpansion(part, trackUnder(state, part), cursor.col),
      );
      return;
    case "ins-repeat":
      writeCells(state, part, cursor.col, repeatExpansion(part, cursor.col));
      return;
    default:
      break;
  }
  const instruction = INSTRUCTION_ACTIONS[action] as Instruction | undefined;
  if (instruction === undefined) return;
  writeCell(state, part, cursor.col, instruction);
  editor.cursor = { part: cursor.part, col: cursor.col + 1 };
}

/** Move the cursor between rows, wrapping at both ends, keeping its column. */
function moveCursorRow(state: OrreryState, forward: boolean): void {
  const editor = state.editor;
  const cursor = editor.cursor;
  if (cursor === null) return;
  const rows = tapeRows(editor.parts);
  const at = rows.findIndex((row) => row.id === cursor.part);
  if (at < 0) return;
  const next = (at + (forward ? 1 : rows.length - 1)) % rows.length;
  editor.cursor = { part: rows[next].id, col: cursor.col };
}

/** The track a part is mounted on, in the shape the macros read it. */
function trackUnder(state: OrreryState, part: PartState): TrackPath | null {
  const track = mountedTrack({ q: part.q, r: part.r }, state.editor.parts);
  if (track === null) return null;
  return { cells: track.cells ?? [], closed: track.closed === true };
}

/** Write one cell of a tape, committing it only if it changed anything. */
function writeCell(
  state: OrreryState,
  part: PartState,
  col: number,
  instruction: Instruction | null,
): void {
  const before = beginEdit(state);
  const at = state.editor.parts.indexOf(part);
  state.editor.parts[at] = {
    ...part,
    tape: writeTapeCell(part.tape, col, instruction),
  };
  commitEdit(state, before);
}

/**
 * Write a macro's expansion from `col` onward, as one edit, and land the
 * cursor immediately after the last cell it wrote. An empty expansion writes
 * nothing and leaves the cursor where it stands.
 */
function writeCells(
  state: OrreryState,
  part: PartState,
  col: number,
  cells: readonly TapeCell[],
): void {
  if (cells.length === 0) return;
  const before = beginEdit(state);
  const tape: TapeCell[] = [...(part.tape ?? [])];
  while (tape.length < col + cells.length) tape.push(null);
  cells.forEach((cell, offset) => {
    tape[col + offset] = cell;
  });
  const at = state.editor.parts.indexOf(part);
  state.editor.parts[at] = { ...part, tape: trimTape(tape) };
  state.editor.cursor = { part: part.id, col: col + cells.length };
  commitEdit(state, before);
}
