// Orrery — `snapshot()` (specs/instrumentation.md "Snapshot shape").
//
// A pure read of the game, returned as plain numbers, strings, booleans, and
// JSON data. It changes nothing: a session whose every frame is snapshotted
// reaches exactly the state of one that is never snapshotted, so every value
// below is copied out rather than handed over by reference.
//
// The shape is FIXED. Every field is present whatever the screen and the mode,
// and a field the current situation does not use reports its resting value
// rather than going missing. The derived fields — the cost, the period, a
// mote's drawn position, the banked area, each mode's challenge count, and
// which challenges hold a stashed machine — are derived here at the read, so
// what the snapshot reports is what the game holds.

import { challengeCount } from "./challenges";
import { EXTRA_COUNT, ORRERY_DEBUG_VERSION } from "./constants";
import { moteStagePosition } from "./cycle";
import { machinePeriod } from "./machine";
import { machineCost } from "./parts";
import {
  type OrreryState,
  lastOf,
  machinesOf,
  recordsOf,
  solvedOf,
} from "./state";
import type { Hex, Metrics, Mode, Molecule, PartState } from "./types";

/** A hex, copied out. */
function hexOut(cell: Hex): { q: number; r: number } {
  return { q: cell.q, r: cell.r };
}

/** Metrics, copied out. */
function metricsOut(metrics: Metrics | null): Metrics | null {
  return metrics === null ? null : { ...metrics };
}

/** A molecule as `specs/formats.md` writes one; `repeat` omitted when absent. */
export function moleculeOut(molecule: Molecule): Record<string, unknown> {
  const out: Record<string, unknown> = {
    motes: molecule.motes.map((mote) => ({
      q: mote.q,
      r: mote.r,
      type: mote.type,
    })),
    filaments: molecule.filaments.map((filament) => ({
      a: hexOut(filament.a),
      b: hexOut(filament.b),
      weight: filament.weight,
    })),
  };
  if (molecule.repeat !== null) {
    out.repeat = {
      vector: hexOut(molecule.repeat.vector),
      link: {
        a: hexOut(molecule.repeat.link.a),
        b: hexOut(molecule.repeat.link.b),
        weight: molecule.repeat.link.weight,
      },
    };
  }
  return out;
}

/** One placed part, as the snapshot reports it. */
export function partOut(part: PartState): Record<string, unknown> {
  return {
    id: part.id,
    kind: part.kind,
    q: part.q,
    r: part.r,
    rotation: part.rotation,
    length: part.length,
    cells: part.cells === null ? null : part.cells.map(hexOut),
    closed: part.closed,
    index: part.index,
    tape: part.tape === null ? null : [...part.tape],
  };
}

/** One mode's half of the snapshot. */
function modeOut(state: OrreryState, mode: Mode): Record<string, unknown> {
  const machines = machinesOf(state, mode);
  const stashed: number[] = [];
  machines.forEach((machine, index) => {
    if (machine !== null) stashed.push(index);
  });
  return {
    count: mode === "extras" ? EXTRA_COUNT : challengeCount("campaign"),
    solved: [...solvedOf(state, mode)],
    records: recordsOf(state, mode).map(metricsOut),
    stashed,
    last: lastOf(state, mode),
  };
}

/** The whole snapshot, as `specs/instrumentation.md` fixes its shape. */
export function snapshotOf(state: OrreryState): Record<string, unknown> {
  const campaign = modeOut(state, "campaign");
  campaign.unlockedCount = state.unlockedCount;
  return {
    version: ORRERY_DEBUG_VERSION,
    screen: state.screen,
    mode: state.mode,
    menuIndex: state.menuIndex,
    selectIndex: state.selectIndex,
    howtoPage: state.howtoPage,
    campaign: {
      count: campaign.count,
      unlockedCount: state.unlockedCount,
      solved: campaign.solved,
      records: campaign.records,
      stashed: campaign.stashed,
      last: campaign.last,
    },
    extras: modeOut(state, "extras"),
    challenge: challengeOut(state),
    editor: editorOut(state),
    sim: simOut(state),
    pointer: { ...state.pointer },
    completion: state.completion,

    muted: state.muted,
    simTime: state.simTime,
  };
}

/** The challenge open in the editor, and where it came from. */
function challengeOut(state: OrreryState): Record<string, unknown> | null {
  const challenge = state.challenge;
  if (challenge === null) return null;
  const ref = state.challengeRef;
  return {
    name: challenge.name,
    reagents: challenge.reagents.map(moleculeOut),
    products: challenge.products.map(moleculeOut),
    permitted: [...challenge.permitted],
    target: challenge.target,
    source: ref === null ? "custom" : ref.mode,
    index: ref === null ? null : ref.index,
  };
}

/** The machine and the hands on it. */
function editorOut(state: OrreryState): Record<string, unknown> {
  const editor = state.editor;
  return {
    parts: editor.parts.map(partOut),
    cost: machineCost(editor.parts),
    period: machinePeriod(editor.parts),
    selected: editor.selected,
    focus: editor.focus,
    cursor:
      editor.cursor === null
        ? null
        : { part: editor.cursor.part, col: editor.cursor.col },
    drag: dragOut(state),
    undoDepth: editor.undo.length,
    redoDepth: editor.redo.length,
  };
}

/** The live drag, in one of its three shapes. */
function dragOut(state: OrreryState): Record<string, unknown> | null {
  const drag = state.editor.drag;
  if (drag === null) return null;
  if (drag.kind === "place") {
    return {
      kind: "place",
      part: drag.part,
      index: drag.index,
      rotation: drag.rotation,
      length: drag.length,
      at: drag.at === null ? null : hexOut(drag.at),
    };
  }
  if (drag.kind === "move") {
    return {
      kind: "move",
      part: drag.part,
      from: hexOut(drag.from),
      at: drag.at === null ? null : hexOut(drag.at),
    };
  }
  return { kind: "lay", part: drag.part, end: drag.end };
}

/** The whole of a run, and `null` while editing. */
function simOut(state: OrreryState): Record<string, unknown> | null {
  const sim = state.sim;
  if (sim === null) return null;
  return {
    status: sim.status,
    cycle: sim.cycle,
    fraction: sim.fraction,
    speed: sim.speed,
    motes: sim.motes.map((mote) => {
      const at = moteStagePosition(mote, sim);
      return {
        id: mote.id,
        q: mote.q,
        r: mote.r,
        x: at.x,
        y: at.y,
        type: mote.type,
        wheel: mote.wheel,
      };
    }),
    filaments: sim.filaments.map((filament) => ({ ...filament })),
    poses: sim.poses.map((pose) => ({
      part: pose.part,
      rotation: pose.rotation,
      length: pose.length,
      cell: hexOut(pose.cell),
    })),
    grips: sim.grips.map((grip) => ({ ...grip })),
    tallies: [...sim.tallies],
    area: sim.areaHexes.length,
    fault:
      sim.fault === null
        ? null
        : {
            kind: sim.fault.kind,
            parts: [...sim.fault.parts],
            motes: [...sim.fault.motes],
          },
    metrics: metricsOut(sim.metrics),
  };
}
