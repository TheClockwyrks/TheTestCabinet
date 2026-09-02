// Orrery — the draft a transition builds (specs/state.md "The contract").
//
// The engine holds the state BY VALUE: `update` and every pose of the debug
// surface receive the current state read-only and return the next one. So a
// transition starts here, with one deep copy of the current state, works over
// that draft, and hands it back. Nothing the copy returns is shared with the
// value it was taken from, so the state the engine still holds is untouched
// until it is replaced — which is what makes a refused pose leave the game
// exactly as it stood, and what lets a caller keep an earlier state and read
// it later.
//
// The one thing carried WHOLE is `sim.pending`, the plan of the cycle now
// running. It is derived data, replaced outright at each boundary and never
// written into, and `src/cycle.ts` applies it to whichever run it is handed —
// so copying it would cost a deep copy of the machine at every frame of a run
// and buy nothing.

import type {
  Challenge,
  Draft,
  EditorState,
  Molecule,
  OrreryState,
  PartState,
  SimState,
  W,
} from "./types";

/** One placed part copied, sharing nothing with the original. */
function copyPart(part: PartState): W<PartState> {
  return {
    ...part,
    cells: part.cells === null ? null : part.cells.map((at) => ({ ...at })),
    tape: part.tape === null ? null : [...part.tape],
  };
}

/** One machine copied. */
function copyMachine(parts: readonly PartState[]): W<PartState>[] {
  return parts.map(copyPart);
}

/** One mode's per-challenge machine stashes copied. */
function copyStashes(
  stashes: readonly (readonly PartState[] | null)[],
): (W<PartState>[] | null)[] {
  return stashes.map((stash) => (stash === null ? null : copyMachine(stash)));
}

/** The editor half of a draft. */
function copyEditor(editor: EditorState): W<EditorState> {
  return {
    parts: copyMachine(editor.parts),
    nextId: editor.nextId,
    selected: editor.selected,
    focus: editor.focus,
    cursor: editor.cursor === null ? null : { ...editor.cursor },
    drag:
      editor.drag === null
        ? null
        : { ...editor.drag, before: copyMachine(editor.drag.before) },
    undo: editor.undo.map(copyMachine),
    redo: editor.redo.map(copyMachine),
  };
}

/** The run half of a draft, and `null` while editing. */
function copySim(sim: SimState | null): W<SimState> | null {
  if (sim === null) return null;
  return {
    status: sim.status,
    cycle: sim.cycle,
    fraction: sim.fraction,
    speed: sim.speed,
    motes: sim.motes.map((mote) => ({ ...mote })),
    nextMoteId: sim.nextMoteId,
    filaments: sim.filaments.map((filament) => ({ ...filament })),
    poses: sim.poses.map((pose) => ({ ...pose, cell: { ...pose.cell } })),
    grips: sim.grips.map((grip) => ({ ...grip })),
    tallies: [...sim.tallies],
    areaHexes: sim.areaHexes.map((at) => ({ ...at })),
    fault:
      sim.fault === null
        ? null
        : {
            kind: sim.fault.kind,
            parts: [...sim.fault.parts],
            motes: [...sim.fault.motes],
          },
    metrics: sim.metrics === null ? null : { ...sim.metrics },
    pending: sim.pending,
  };
}

/** The open challenge copied, and `null` when none is open. */
function copyChallenge(challenge: Challenge | null): W<Challenge> | null {
  if (challenge === null) return null;
  return {
    name: challenge.name,
    reagents: challenge.reagents.map(copyMolecule),
    products: challenge.products.map(copyMolecule),
    permitted: [...challenge.permitted],
    target: challenge.target,
  };
}

/** One molecule pattern copied. */
function copyMolecule(molecule: Molecule): W<Molecule> {
  return {
    motes: molecule.motes.map((mote) => ({ ...mote })),
    filaments: molecule.filaments.map((filament) => ({
      a: { ...filament.a },
      b: { ...filament.b },
      weight: filament.weight,
    })),
    repeat:
      molecule.repeat === null
        ? null
        : {
            vector: { ...molecule.repeat.vector },
            link: {
              a: { ...molecule.repeat.link.a },
              b: { ...molecule.repeat.link.b },
              weight: molecule.repeat.link.weight,
            },
          },
  };
}

/** The whole state copied: the draft the next transition is built in. */
export function cloneState(state: OrreryState): Draft {
  return {
    screen: state.screen,
    mode: state.mode,
    menuIndex: state.menuIndex,
    selectIndex: state.selectIndex,
    howtoPage: state.howtoPage,

    unlockedCount: state.unlockedCount,
    campaignSolved: [...state.campaignSolved],
    extrasSolved: [...state.extrasSolved],
    campaignRecords: state.campaignRecords.map((record) =>
      record === null ? null : { ...record },
    ),
    extrasRecords: state.extrasRecords.map((record) =>
      record === null ? null : { ...record },
    ),
    campaignMachines: copyStashes(state.campaignMachines),
    extrasMachines: copyStashes(state.extrasMachines),
    campaignLast: state.campaignLast,
    extrasLast: state.extrasLast,

    challenge: copyChallenge(state.challenge),
    challengeRef:
      state.challengeRef === null ? null : { ...state.challengeRef },
    editor: copyEditor(state.editor),
    sim: copySim(state.sim),

    pointer: { ...state.pointer },
    completion: state.completion,
    simTime: state.simTime,
    muted: state.muted,
  };
}
