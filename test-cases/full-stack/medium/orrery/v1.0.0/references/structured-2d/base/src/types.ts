// Orrery — the declarations every other module is written against
// (specs/state.md, specs/field.md, specs/parts.md, specs/instructions.md,
// specs/simulation.md, specs/formats.md).
//
// These are the types `specs/state.md` declares `OrreryState` from, written out
// once here and re-exported from `src/game.ts` as the module contract asks.
// `OrreryState` itself is a class rather than an interface — the world's game
// state, which the engine builds from the mode's `gameStateClass` — so it lives
// beside the helpers that read it, in `src/state.ts`.
//
// Nothing here imports anything: this is the bottom of the module graph.

/** The top-level state machine (specs/state.md, specs/ui.md). */
export type Screen = "title" | "howto" | "select" | "editor";

/** The course the `select` and `editor` screens serve (specs/ui.md). */
export type Mode = "campaign" | "extras";

/** The fifteen celestial bodies of `MOTES` (specs/field.md). */
export type MoteType =
  | "dust"
  | "nebula"
  | "comet"
  | "nova"
  | "meteor"
  | "mercury"
  | "saturn"
  | "jupiter"
  | "mars"
  | "venus"
  | "luna"
  | "sol"
  | "umbra"
  | "lumen"
  | "aether";

/** The four essences, in `ESSENCES` order (specs/field.md). */
export type EssenceType = "nebula" | "comet" | "nova" | "meteor";

/** The planetary ladder, in `PLANETS` order (specs/field.md). */
export type PlanetType =
  "saturn" | "jupiter" | "mars" | "venus" | "luna" | "sol";

/** The twenty-one part kinds of `PARTS` (specs/parts.md). */
export type PartKind =
  | "arm"
  | "biarm"
  | "triarm"
  | "hexarm"
  | "piston"
  | "wheel"
  | "track"
  | "bind"
  | "manifold"
  | "triune"
  | "sunder"
  | "wane"
  | "mirror"
  | "ascend"
  | "conjoin"
  | "eclipse"
  | "confluence"
  | "dispersion"
  | "void"
  | "rise"
  | "set";

/** The five arm kinds: a base, a length, and one gripper per spoke. */
export type ArmKind = "arm" | "biarm" | "triarm" | "hexarm" | "piston";

/** The twelve transforming sigils, `bind` through `void` (specs/sigils.md). */
export type TransformingSigilKind =
  | "bind"
  | "manifold"
  | "triune"
  | "sunder"
  | "wane"
  | "mirror"
  | "ascend"
  | "conjoin"
  | "eclipse"
  | "confluence"
  | "dispersion"
  | "void";

/** The ten instructions of `INSTRUCTIONS` (specs/instructions.md). */
export type Instruction =
  | "grab"
  | "drop"
  | "rotate-cw"
  | "rotate-ccw"
  | "pivot-cw"
  | "pivot-ccw"
  | "extend"
  | "retract"
  | "advance"
  | "recede";

/** One tape cell: an instruction, or a blank rest. */
export type TapeCell = Instruction | null;

/** The four statuses a run passes through (specs/simulation.md). */
export type SimStatus = "running" | "paused" | "faulted" | "complete";

/** Every way a run halts, `FAULTS` (specs/simulation.md). */
export type FaultKind =
  | "collision"
  | "torn"
  | "overextended"
  | "overretracted"
  | "unmounted"
  | "track-end"
  | "impossible";

/** Which half of the editor the editing keys are routed to (specs/controls.md). */
export type Focus = "field" | "tape";

/** An axial hex coordinate (specs/field.md). */
export interface Hex {
  q: number;
  r: number;
}

/** A link between two pattern hexes, of weight `1` or `3` (specs/formats.md). */
export interface PatternFilament {
  a: Hex;
  b: Hex;
  weight: number;
}

/** A molecule pattern: motes on relative hexes, and the links between them. */
export interface Molecule {
  motes: { q: number; r: number; type: MoteType }[];
  filaments: PatternFilament[];
  repeat: { vector: Hex; link: PatternFilament } | null;
}

/** A challenge document, as `specs/formats.md` writes one. */
export interface Challenge {
  name: string;
  reagents: Molecule[];
  products: Molecule[];
  permitted: PartKind[];
  target: number;
}

/**
 * One placed part: exactly the facts a solution records, plus `id`, unique
 * among the machine's parts for its lifetime and granted from `editor.nextId`.
 */
export interface PartState {
  id: number;
  kind: PartKind;
  /** The anchor hex. For a track this mirrors the first cell of `cells`. */
  q: number;
  r: number;
  /** `0` to `5` as specs/field.md counts them, and `0` for a track. */
  rotation: number;
  /** The rest length, `1` to `3` for arms and pistons; `1` otherwise. */
  length: number;
  /** The path, for a track; `null` for everything else. */
  cells: Hex[] | null;
  /** The loop flag, for a track; `null` for everything else. */
  closed: boolean | null;
  /** Which reagent or product, for a rise or set; `null` otherwise. */
  index: number | null;
  /** The trimmed tape, for arms and wheels; `null` for everything else. */
  tape: TapeCell[] | null;
}

/**
 * The live drag, in one of its three shapes (specs/editor.md). Each carries
 * `before`, the machine as it stood when the press began: a whole gesture is
 * one edit, so the entry the release commits is taken at the press rather than
 * rebuilt from what the gesture did.
 */
export type DragState =
  | {
      kind: "place";
      part: PartKind;
      index: number | null;
      rotation: number;
      length: number;
      at: Hex | null;
      before: PartState[];
    }
  | {
      kind: "move";
      part: number;
      from: Hex;
      at: Hex | null;
      /** The ghost's rotation, which the release carries onto the part. */
      rotation: number;
      /** The ghost's length, carried the same way. */
      length: number;
      before: PartState[];
    }
  | { kind: "lay"; part: number; end: "first" | "last"; before: PartState[] };

/** The machine, and the hands on it (specs/state.md). */
export interface EditorState {
  parts: PartState[];
  nextId: number;
  selected: number | null;
  focus: Focus;
  cursor: { part: number; col: number } | null;
  drag: DragState | null;
  undo: PartState[][];
  redo: PartState[][];
}

/** One mote, at rest on the hex it held at the last boundary. */
export interface MoteState {
  id: number;
  q: number;
  r: number;
  type: MoteType;
  /** The wheel a fixture belongs to; `null` on every real mote. */
  wheel: number | null;
}

/** One filament, by mote ids, of weight `1` or `3`. */
export interface SimFilament {
  a: number;
  b: number;
  weight: number;
}

/** One arm or wheel's live pose: separate from its rest pose. */
export interface Pose {
  part: number;
  rotation: number;
  length: number;
  cell: Hex;
}

/** One holding gripper: the part, its spoke direction, and the mote at it. */
export interface Grip {
  part: number;
  spoke: number;
  mote: number;
}

/** The three figures a completed run records (specs/simulation.md). */
export interface Metrics {
  cost: number;
  cycles: number;
  area: number;
}

/** What raised a fault, and on what (specs/simulation.md). */
export interface Fault {
  kind: FaultKind;
  parts: number[];
  motes: number[];
}

/**
 * What the cycle now running will do, resolved at the moment the cycle began
 * (specs/simulation.md). Derived from the machine and the run, never reported
 * by the snapshot, and discarded with the run it belongs to.
 */
export interface CyclePlan {
  /**
   * The fault this cycle raises and the fraction it freezes at: `0` for a
   * fetch fault or a tear, and the sample's `k / 8` for a collision.
   */
  readonly fault: { readonly fault: Fault; readonly fraction: number } | null;
  /** Land every mote on the hex the motion step leaves it on. */
  land(): void;
  /**
   * Where mote `mote` is drawn at fraction `t` of this cycle, and `null` for a
   * mote this cycle resolved no motion for, which rests on its own hex.
   */
  position(mote: number, t: number): { x: number; y: number } | null;
}

/** The whole of a run, and `null` while editing (specs/state.md). */
export interface SimState {
  status: SimStatus;
  cycle: number;
  fraction: number;
  speed: number;
  motes: MoteState[];
  nextMoteId: number;
  filaments: SimFilament[];
  poses: Pose[];
  grips: Grip[];
  tallies: number[];
  areaHexes: Hex[];
  fault: Fault | null;
  metrics: Metrics | null;
  /**
   * The cycle now running, resolved once at its start; `null` before a cycle
   * has begun. Derived, and no part of what a snapshot or a reset touches.
   */
  pending: CyclePlan | null;
}

/** The pointer as of this frame, in the stage's logical units. */
export interface PointerState {
  x: number;
  y: number;
  down: boolean;
}

/** A solution document's one part, as `specs/formats.md` writes one. */
export interface SolutionPart {
  kind: PartKind;
  q?: number;
  r?: number;
  rotation?: number;
  length?: number;
  cells?: Hex[];
  closed?: boolean;
  index?: number;
  tape?: TapeCell[];
}

/** A machine, as `specs/formats.md` writes one. */
export interface Solution {
  parts: SolutionPart[];
}
