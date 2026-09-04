// Orrery — the state declaration, and the vocabulary every module is written
// against (specs/state.md, specs/field.md, specs/parts.md,
// specs/instructions.md, specs/simulation.md, specs/formats.md).
//
// `specs/state.md` fixes this declaration, and `src/game.ts` re-exports every
// name below so the state is reachable exactly where that file says it is.
// It lives here rather than in `src/game.ts` because this is the bottom of the
// module graph: nothing here imports a value, so the simulation, the editor,
// and the drawing all read the same types without a cycle between them.
//
// EVERY FIELD IS `readonly`. The engine holds the state by value and replaces
// it with whatever `update` returns, so a frame builds the NEXT state from the
// current one rather than writing into it, and every reader — `update`,
// `render`, each diagnostic source, and each operation of the debug surface —
// is handed `DeepReadonly<OrreryState>`. The modifiers are what make that a
// fact the compiler checks rather than a comment.
//
// A transition still has to build its next state somehow, and that is what
// {@link W} is for: `W<OrreryState>` is the same state with every one of those
// modifiers lifted, which is the DRAFT a transition works over. The draft is
// never the value the engine holds — `src/game.ts` clones the current state
// into one, the simulation and the editor write into it, and the finished
// draft is returned as the next state. Writable flows into readonly freely, so
// a draft satisfies every reader; readonly does not flow back, which is what
// keeps a reader from being handed something it could write into.

/**
 * The draft view of a declared type: `T` with every `readonly` lifted, all the
 * way down.
 *
 * A builder returns `W<T>` and a reader takes `T`. That direction is the whole
 * convention: `W<T>` is assignable to `T`, so a draft may be read anywhere,
 * and `T` is not assignable to `W<T>`, so a value handed over read-only can
 * never be written into by mistake.
 *
 * A {@link CyclePlan} is the one thing a draft carries WHOLE. It is derived
 * data a boundary replaces outright and nothing ever writes a field of, and it
 * quotes the machine's parts, so descending into it would demand a writable
 * copy of a part the run has locked. The first branch below is what stops the
 * descent; every other shape is mapped, arrays included.
 */
export type W<T> = T extends CyclePlan
  ? T
  : T extends readonly (infer E)[]
    ? W<E>[]
    : T extends object
      ? { -readonly [K in keyof T]: W<T[K]> }
      : T;

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

/** The five arm kinds, which share one anatomy (specs/parts.md). */
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
  readonly q: number;
  readonly r: number;
}

/** A link between two pattern hexes, of weight `1` or `3` (specs/formats.md). */
export interface PatternFilament {
  readonly a: Hex;
  readonly b: Hex;
  readonly weight: number;
}

/** A molecule pattern: motes on relative hexes, and the links between them. */
export interface Molecule {
  readonly motes: readonly {
    readonly q: number;
    readonly r: number;
    readonly type: MoteType;
  }[];
  readonly filaments: readonly PatternFilament[];
  readonly repeat: {
    readonly vector: Hex;
    readonly link: PatternFilament;
  } | null;
}

/** A challenge document, as `specs/formats.md` writes one. */
export interface Challenge {
  readonly name: string;
  readonly reagents: readonly Molecule[];
  readonly products: readonly Molecule[];
  readonly permitted: readonly PartKind[];
  readonly target: number;
}

/**
 * One placed part: exactly the facts a solution records, plus `id`, unique
 * among the machine's parts for its lifetime and granted from `editor.nextId`.
 */
export interface PartState {
  readonly id: number;
  readonly kind: PartKind;
  /** The anchor hex. For a track this mirrors the first cell of `cells`. */
  readonly q: number;
  readonly r: number;
  /** `0` to `5` as specs/field.md counts them, and `0` for a track. */
  readonly rotation: number;
  /** The rest length, `1` to `3` for arms and pistons; `1` otherwise. */
  readonly length: number;
  /** The path, for a track; `null` for everything else. */
  readonly cells: readonly Hex[] | null;
  /** The loop flag, for a track; `null` for everything else. */
  readonly closed: boolean | null;
  /** Which reagent or product, for a rise or set; `null` otherwise. */
  readonly index: number | null;
  /** The trimmed tape, for arms and wheels; `null` for everything else. */
  readonly tape: readonly TapeCell[] | null;
}

/**
 * The live drag, in one of its three shapes (specs/editor.md, specs/state.md).
 *
 * Each carries two working fields beyond what `specs/state.md` declares and
 * what the snapshot reports, because a gesture is resolved over several frames
 * and the state is the only thing that survives between them: `before` is the
 * machine as it stood when the press began, so the undo entry the release
 * commits is taken at the PRESS rather than rebuilt from what the gesture did,
 * and a `move` drag's `rotation` and `length` are the ghost's, which the four
 * drag verbs of `specs/editor.md` turn and stretch under the pointer and the
 * release carries onto the part.
 */
export type DragState =
  | {
      readonly kind: "place";
      readonly part: PartKind;
      readonly index: number | null;
      readonly rotation: number;
      readonly length: number;
      readonly at: Hex | null;
      readonly before: readonly PartState[];
    }
  | {
      readonly kind: "move";
      readonly part: number;
      readonly from: Hex;
      readonly at: Hex | null;
      readonly rotation: number;
      readonly length: number;
      readonly before: readonly PartState[];
    }
  | {
      readonly kind: "lay";
      readonly part: number;
      readonly end: "first" | "last";
      readonly before: readonly PartState[];
    };

/** The machine, and the hands on it (specs/state.md). */
export interface EditorState {
  readonly parts: readonly PartState[];
  readonly nextId: number;
  readonly selected: number | null;
  readonly focus: Focus;
  readonly cursor: { readonly part: number; readonly col: number } | null;
  readonly drag: DragState | null;
  readonly undo: readonly (readonly PartState[])[];
  readonly redo: readonly (readonly PartState[])[];
}

/** One mote, at rest on the hex it held at the last boundary. */
export interface MoteState {
  readonly id: number;
  readonly q: number;
  readonly r: number;
  readonly type: MoteType;
  /** The wheel a fixture belongs to; `null` on every real mote. */
  readonly wheel: number | null;
}

/** One filament, by mote ids, of weight `1` or `3`. */
export interface SimFilament {
  readonly a: number;
  readonly b: number;
  readonly weight: number;
}

/** One arm or wheel's live pose: separate from its rest pose. */
export interface Pose {
  readonly part: number;
  readonly rotation: number;
  readonly length: number;
  readonly cell: Hex;
}

/** One holding gripper: the part, its spoke direction, and the mote at it. */
export interface Grip {
  readonly part: number;
  readonly spoke: number;
  readonly mote: number;
}

/** The three figures a completed run records (specs/simulation.md). */
export interface Metrics {
  readonly cost: number;
  readonly cycles: number;
  readonly area: number;
}

/** What raised a fault, and on what (specs/simulation.md). */
export interface Fault {
  readonly kind: FaultKind;
  readonly parts: readonly number[];
  readonly motes: readonly number[];
}

/** Which way a rotation turns: `1` clockwise, `-1` counterclockwise. */
export type Turn = 1 | -1;

/** A point on the stage, in the logical units specs/field.md places hexes in. */
export interface StagePoint {
  readonly x: number;
  readonly y: number;
}

/** One rigid motion over the unit interval (specs/simulation.md). */
export type Motion =
  | { readonly kind: "rest" }
  | { readonly kind: "translate"; readonly vector: Hex }
  | { readonly kind: "rotate"; readonly center: Hex; readonly turn: Turn };

/** What one mote does over one cycle: where it began, its motion, where it lands. */
export interface MoteMotion {
  readonly mote: number;
  readonly from: Hex;
  readonly motion: Motion;
  readonly to: Hex;
}

/** What one part does this cycle: the cell it fetched, and what that imposes. */
export interface PartStep {
  /** The part as the editor placed it; locked for the whole run. */
  readonly part: PartState;
  /** The live pose the part stands in as the cycle begins. */
  readonly pose: Pose;
  /** The cell this part executes this cycle; `null` is a rest. */
  readonly cell: TapeCell;
  /** The live pose the part stands in once the cycle's motion has landed. */
  readonly next: Pose;
  /**
   * The motion imposed on whatever this part's grippers hold, or `null` for a
   * pivot, whose center is the holding gripper's own hex rather than the
   * part's.
   */
  readonly carried: Motion | null;
}

/**
 * What the cycle now running will do, resolved at the moment the cycle began
 * (specs/simulation.md). Derived from the machine and the run as they stood at
 * the boundary, never reported by the snapshot, and discarded with the run it
 * belongs to.
 *
 * It is PLAIN DATA rather than a pair of closures over the run it was planned
 * against, because the engine holds the state by value: a frame builds the
 * next state from the current one, so a plan that had captured last frame's
 * run would land its motion into a state nothing is holding any more.
 * `landPlan` and `planPosition` in `src/cycle.ts` apply it to whichever run
 * they are handed, which is always the draft the frame is building.
 */
export interface CyclePlan {
  /**
   * The fault this cycle raises and the fraction it freezes at: `0` for a
   * fetch fault or a tear, and the sample's `k / 8` for a collision.
   */
  readonly fault: { readonly fault: Fault; readonly fraction: number } | null;
  /** What each mote in motion does this cycle, in resolution order. */
  readonly carried: readonly MoteMotion[];
  /** What each arm and wheel does this cycle, in placement order. */
  readonly steps: readonly PartStep[];
}

/** The whole of a run, and `null` while editing (specs/state.md). */
export interface SimState {
  readonly status: SimStatus;
  readonly cycle: number;
  readonly fraction: number;
  readonly speed: number;
  readonly motes: readonly MoteState[];
  readonly nextMoteId: number;
  readonly filaments: readonly SimFilament[];
  readonly poses: readonly Pose[];
  readonly grips: readonly Grip[];
  readonly tallies: readonly number[];
  readonly areaHexes: readonly Hex[];
  readonly fault: Fault | null;
  readonly metrics: Metrics | null;
  /**
   * The cycle now running, resolved once at its start; `null` before a cycle
   * has begun. Derived from the fields above and the machine, so it is rebuilt
   * rather than restored, and no part of what a snapshot or a reset touches.
   */
  readonly pending: CyclePlan | null;
}

/** The pointer as of this frame, in the stage's logical units. */
export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

/**
 * The whole of Orrery's state (specs/state.md). Every field is present from
 * the moment `initialize` returns, and every one is plain data, so a scenario
 * is posed by building a state that differs in the fields posed and read back
 * by reading them.
 */
export interface OrreryState {
  readonly screen: Screen;
  readonly mode: Mode;
  readonly menuIndex: number;
  /**
   * The title menu's remembered selection: the index of the last title item
   * TAKEN, which arriving at `title` puts the highlight back on, so a return
   * lands on the entry that led away (specs/ui.md "The remembered title
   * selection"). `0` until the first one is taken, and `0` again after a
   * `reset`.
   */
  readonly titleIndex: number;
  readonly selectIndex: number;
  readonly howtoPage: number;

  readonly unlockedCount: number;
  readonly campaignSolved: readonly number[];
  readonly extrasSolved: readonly number[];
  readonly campaignRecords: readonly (Metrics | null)[];
  readonly extrasRecords: readonly (Metrics | null)[];
  readonly campaignMachines: readonly (readonly PartState[] | null)[];
  readonly extrasMachines: readonly (readonly PartState[] | null)[];
  readonly campaignLast: number;
  readonly extrasLast: number;

  readonly challenge: Challenge | null;
  readonly challengeRef: { readonly mode: Mode; readonly index: number } | null;
  readonly editor: EditorState;
  readonly sim: SimState | null;

  readonly pointer: PointerState;
  /**
   * The menu item a live press landed in, and `null` when none did.
   *
   * A take needs BOTH its edges inside one item's region (specs/ui.md "Pointer
   * and touch"), and `pointer` cannot answer that: it carries where the
   * pointer is now, and the press position is gone at the first move. So the
   * one fact a split gesture turns on is carried here, beside the reading it
   * belongs to. It is never reported by the snapshot — the shape
   * specs/instrumentation.md fixes carries no such field — and a `reset`
   * clears it with the rest.
   */
  readonly menuPress: number | null;
  /** Whether a satisfied boundary completes the run (specs/instrumentation.md). */
  readonly completion: boolean;
  /** Accumulated simulation time, in seconds; every update adds its `dt`. */
  readonly simTime: number;
  /** The game's readable copy of the engine's mute bit. */
  readonly muted: boolean;
}

/** The state as every reader is handed it, and as a transition receives it. */
export type StateView = OrreryState;

/** The state as a transition builds it: the whole of `OrreryState`, writable. */
export type Draft = W<OrreryState>;

/** A solution document's one part, as `specs/formats.md` writes one. */
export interface SolutionPart {
  readonly kind: PartKind;
  readonly q?: number;
  readonly r?: number;
  readonly rotation?: number;
  readonly length?: number;
  readonly cells?: readonly Hex[];
  readonly closed?: boolean;
  readonly index?: number;
  readonly tape?: readonly TapeCell[];
}

/** A machine, as `specs/formats.md` writes one. */
export interface Solution {
  readonly parts: readonly SolutionPart[];
}
