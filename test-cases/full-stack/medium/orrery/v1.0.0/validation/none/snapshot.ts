// Orrery — the snapshot `specs/instrumentation.md` fixes, as types, and the small
// readings a check makes over one. CASE-PROVIDED, and the SAME FILE in all three
// engine projects.
//
// THE SNAPSHOT IS THE ONE SHAPE THE CASE IMPOSES ON A BUILD. Everything else about
// how a build holds its state is the build's; `snapshot()` is a projection out of
// it, and `specs/instrumentation.md` fixes that projection field for field. So
// this file is that section of the specification written as TypeScript, and it is
// the only description of a snapshot any of the three projects reads: no build's
// own module for it is ever imported.
//
// EVERY FIELD IS PRESENT WHATEVER THE SCREEN AND MODE. A field the current
// situation does not use reports its resting value rather than going missing, so
// nothing below but `autoStep` is optional — and `autoStep` is optional only
// because the specification carries it under NO ENGINE alone, where the clock is
// the build's. Declaring it optional in all three projects is what lets one suite
// text compile in all three.

import type {
  FaultName,
  FocusName,
  InstructionName,
  MetricName,
  ModeName,
  MoteName,
  PartName,
  ScreenName,
  SimStatusName,
} from "./constants";
import type { Hex } from "./field";
import type { Molecule } from "./formats";

/** The three metrics a completed run records (`specs/simulation.md`). */
export type Metrics = Readonly<Record<MetricName, number>>;

/** One mode's progress, as the snapshot reports it. */
export interface ProgressView {
  /** How many challenges the mode's list holds. */
  count: number;
  /** Campaign only: how many are open. Absent on the Extras, which lock nothing. */
  unlockedCount?: number;
  /** Solved indices, ascending. */
  solved: number[];
  /** One entry per challenge, `null` until its first completion. */
  records: (Metrics | null)[];
  /** Ascending indices with a stashed machine. */
  stashed: number[];
  /** Where the mode's select screen lands. */
  last: number;
}

/** The challenge open in the editor, as the snapshot reports it. */
export interface ChallengeView {
  name: string;
  reagents: Molecule[];
  products: Molecule[];
  permitted: PartName[];
  target: number;
  source: ModeName | "custom";
  /** `null` when `source` is `"custom"`. */
  index: number | null;
}

/** One placed part, as the snapshot reports it. */
export interface PartView {
  id: number;
  kind: PartName;
  q: number;
  r: number;
  rotation: number;
  length: number;
  /** A track's path, in order; `null` for everything else. */
  cells: Hex[] | null;
  /** A track's loop flag; `null` for everything else. */
  closed: boolean | null;
  /** Which reagent or product, for a rise or set; `null` for everything else. */
  index: number | null;
  /** The tape, for arms and wheels; `null` for everything else. Trimmed. */
  tape: (InstructionName | null)[] | null;
}

/** The live drag, in one of its three shapes (`specs/instrumentation.md`). */
export type DragView =
  | {
      kind: "place";
      part: PartName;
      index: number | null;
      rotation: number;
      length: number;
      /** The targeted hex, `null` off every hex. */
      at: Hex | null;
    }
  | {
      kind: "move";
      part: number;
      /** The hex the press grabbed. */
      from: Hex;
      at: Hex | null;
    }
  | { kind: "lay"; part: number; end: "first" | "last" };

/** The machine and the hands on it, as the snapshot reports them. */
export interface EditorView {
  /** Placement order, which is the tape panel's row order. */
  parts: PartView[];
  cost: number;
  period: number;
  selected: number | null;
  focus: FocusName;
  cursor: { part: number; col: number } | null;
  drag: DragView | null;
  undoDepth: number;
  redoDepth: number;
}

/** One mote, as the snapshot reports it. */
export interface MoteView {
  id: number;
  /** The hex at the last boundary. */
  q: number;
  r: number;
  /** The drawn position at the current fraction, in stage units. */
  x: number;
  y: number;
  type: MoteName;
  /** The wheel a fixture belongs to; `null` on every real mote. */
  wheel: number | null;
}

/** One filament, by mote ids. */
export interface FilamentView {
  a: number;
  b: number;
  weight: number;
}

/** One part's live pose. */
export interface PoseView {
  part: number;
  rotation: number;
  length: number;
  cell: Hex;
}

/** One holding gripper. */
export interface GripView {
  part: number;
  spoke: number;
  mote: number;
}

/** What stopped a run (`specs/simulation.md`). */
export interface FaultView {
  kind: FaultName;
  /** In placement order. */
  parts: number[];
  /** In ascending mote id. */
  motes: number[];
}

/** The whole of a run, and `null` while editing. */
export interface SimView {
  status: SimStatusName;
  cycle: number;
  fraction: number;
  /** The `SPEEDS` index. */
  speed: number;
  motes: MoteView[];
  filaments: FilamentView[];
  poses: PoseView[];
  grips: GripView[];
  /** One entry per product, in product order. */
  tallies: number[];
  /** Distinct hexes banked so far. */
  area: number;
  fault: FaultView | null;
  metrics: Metrics | null;
}

/** The pointer as of this frame, in stage units. */
export interface PointerView {
  x: number;
  y: number;
  down: boolean;
}

/** What `snapshot` returns (`specs/instrumentation.md`, Snapshot shape). */
export interface OrrerySnapshot {
  version: number;
  screen: ScreenName;
  mode: ModeName;
  menuIndex: number;
  selectIndex: number;
  howtoPage: number;
  campaign: ProgressView;
  extras: ProgressView;
  challenge: ChallengeView | null;
  editor: EditorView;
  sim: SimView | null;
  pointer: PointerView;
  /** The completion switch. */
  completion: boolean;
  /**
   * Whether the frame loop advances the simulation from the wall clock.
   *
   * `specs/instrumentation.md` carries this field under NO ENGINE alone: under
   * either engine the clock is the engine's and the surface has no switch over
   * it. Optional here so one suite text compiles in all three projects.
   */
  autoStep?: boolean;
  muted: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/* -------------------------------------------------------------------------- */
/* Readings over one snapshot                                                 */
/* -------------------------------------------------------------------------- */
//
// Each of these answers `null` or an empty list rather than throwing: a check
// that asked for a part the build never reported wants to fail on the reading it
// was making, with the value it measured beside the value the specification
// required, rather than on a helper's own stack.

/** The placed part with `id`, or `null` when the machine reports none. */
export function partById(
  snapshot: OrrerySnapshot,
  id: number,
): PartView | null {
  return snapshot.editor.parts.find((part) => part.id === id) ?? null;
}

/** Every placed part of `kind`, in placement order. */
export function partsOfKind(
  snapshot: OrrerySnapshot,
  kind: PartName,
): PartView[] {
  return snapshot.editor.parts.filter((part) => part.kind === kind);
}

/** The one placed part of `kind`, or `null` when there is not exactly one. */
export function solePartOfKind(
  snapshot: OrrerySnapshot,
  kind: PartName,
): PartView | null {
  const found = partsOfKind(snapshot, kind);
  return found.length === 1 ? (found[0] as PartView) : null;
}

/** The mote with `id`, or `null` when the run reports none. */
export function moteById(
  snapshot: OrrerySnapshot,
  id: number,
): MoteView | null {
  return snapshot.sim?.motes.find((mote) => mote.id === id) ?? null;
}

/** The mote resting on `hex` at the last boundary, or `null` for a bare hex. */
export function moteAt(snapshot: OrrerySnapshot, hex: Hex): MoteView | null {
  return (
    snapshot.sim?.motes.find((mote) => mote.q === hex.q && mote.r === hex.r) ??
    null
  );
}

/** Every mote that is not a fixture: `wheel` is `null` on every real mote. */
export function looseMotes(snapshot: OrrerySnapshot): MoteView[] {
  return (snapshot.sim?.motes ?? []).filter((mote) => mote.wheel === null);
}

/** Every fixture of the wheel `part` carries, in the order the run reports them. */
export function fixturesOf(snapshot: OrrerySnapshot, part: number): MoteView[] {
  return (snapshot.sim?.motes ?? []).filter((mote) => mote.wheel === part);
}

/** The live pose of `part`, or `null` when the run carries none for it. */
export function poseOf(
  snapshot: OrrerySnapshot,
  part: number,
): PoseView | null {
  return snapshot.sim?.poses.find((pose) => pose.part === part) ?? null;
}

/** Every gripper of `part` that is holding, in the order the run reports them. */
export function gripsOf(snapshot: OrrerySnapshot, part: number): GripView[] {
  return (snapshot.sim?.grips ?? []).filter((grip) => grip.part === part);
}

/** The mote the gripper on `spoke` of `part` holds, or `null` when it holds none. */
export function heldBy(
  snapshot: OrrerySnapshot,
  part: number,
  spoke: number,
): number | null {
  return (
    snapshot.sim?.grips.find(
      (grip) => grip.part === part && grip.spoke === spoke,
    )?.mote ?? null
  );
}

/** The filament joining two motes, or `null` when none does. */
export function filamentBetween(
  snapshot: OrrerySnapshot,
  a: number,
  b: number,
): FilamentView | null {
  return (
    snapshot.sim?.filaments.find(
      (filament) =>
        (filament.a === a && filament.b === b) ||
        (filament.a === b && filament.b === a),
    ) ?? null
  );
}

/**
 * The mote ids of the constellation `mote` belongs to: the maximal group joined
 * by filaments (`specs/field.md`). A lone mote is a constellation of one.
 */
export function constellationOf(
  snapshot: OrrerySnapshot,
  mote: number,
): number[] {
  const filaments = snapshot.sim?.filaments ?? [];
  const seen = new Set<number>([mote]);
  const queue = [mote];
  while (queue.length > 0) {
    const here = queue.shift() as number;
    for (const filament of filaments) {
      const other =
        filament.a === here
          ? filament.b
          : filament.b === here
            ? filament.a
            : null;
      if (other !== null && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** One product's tally, or `null` when the run reports no entry for it. */
export function tallyOf(
  snapshot: OrrerySnapshot,
  product: number,
): number | null {
  return snapshot.sim?.tallies[product] ?? null;
}

/** The progress the snapshot reports for `mode`. */
export function progressOf(
  snapshot: OrrerySnapshot,
  mode: ModeName,
): ProgressView {
  return mode === "campaign" ? snapshot.campaign : snapshot.extras;
}

/** The id of the part placed last, or `null` on an empty machine. */
export function lastPartId(snapshot: OrrerySnapshot): number | null {
  const parts = snapshot.editor.parts;
  return parts.length === 0 ? null : (parts[parts.length - 1] as PartView).id;
}

/** The id of the mote spawned last, or `null` with no live run and no motes. */
export function lastMoteId(snapshot: OrrerySnapshot): number | null {
  const motes = snapshot.sim?.motes ?? [];
  return motes.length === 0 ? null : (motes[motes.length - 1] as MoteView).id;
}
