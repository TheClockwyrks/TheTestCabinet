// Orrery — the specification's figures in the simulation's own vocabulary
// (specs/field.md, specs/parts.md, specs/sigils.md, specs/instructions.md,
// specs/ui.md, specs/controls.md).
//
// `src/constants.ts` is supplied with the project and holds every figure the
// specification fixes under the name the specification gives it. This module
// derives from it — and from nowhere else — the tables the rest of the build
// reads by: the rosters `specs/parts.md` and `specs/sigils.md` name as subsets
// of `PARTS`, the sigil footprints and the order their waves run in, the
// instruction each tape-focus action writes, and which actions each screen
// answers. Nothing below is a new number: every value is either quoted from a
// specification table that `src/constants.ts` does not tabulate, or computed
// from a constant that states it.
//
// The three type aliases at the top exist because `src/constants.ts` names the
// rosters `MoteName`, `PartName`, `InstructionName`, `ActionName`, and
// `CueName` while `specs/state.md` declares the state against `MoteType`,
// `PartKind`, `Instruction`, and the surface against a cue and an action name.
// `src/types.ts` carries the specification's names; these bind the two
// together so a value crossing between them needs no cast.

import {
  DIRS as DIR_OFFSETS,
  PARTICLE_PATHS,
  PART_COSTS,
  type ActionName,
  type CueName,
} from "./constants";
import type {
  ArmKind,
  Hex,
  Instruction,
  Screen,
  TransformingSigilKind,
} from "./types";

/** One registered action's name, as `specs/controls.md` lists them. */
export type Action = ActionName;

/** One cue's name, as `specs/ui.md` tabulates them. */
export type Cue = CueName;

/** One produced particle system's name (specs/assets.md). */
export type ParticleSystemName = keyof typeof PARTICLE_PATHS;

// ---------------------------------------------------------------------------
// The field (specs/field.md)
// ---------------------------------------------------------------------------

/**
 * The six neighbour offsets as axial hexes, indexed `0..5` clockwise on the
 * stage from east — `src/constants.ts` states them as `[dq, dr]` pairs, and
 * every hex in this build is a `{ q, r }`.
 */
export const DIRS: readonly Hex[] = DIR_OFFSETS.map(([q, r]) => ({ q, r }));

/** A plain filament's weight (specs/field.md "Filaments and constellations"). */
export const FILAMENT_WEIGHT = 1;

/** A triune filament's weight; `triune` alone creates one (specs/sigils.md). */
export const TRIUNE_WEIGHT = 3;

// ---------------------------------------------------------------------------
// Parts (specs/parts.md)
// ---------------------------------------------------------------------------

/** The five arm kinds, which share one anatomy. */
export const ARM_KINDS: readonly ArmKind[] = [
  "arm",
  "biarm",
  "triarm",
  "hexarm",
  "piston",
];

/** Each arm kind's gripper spokes, as offsets from the part's rotation. */
export const ARM_SPOKE_OFFSETS: Record<ArmKind, readonly number[]> = {
  arm: [0],
  piston: [0],
  biarm: [0, 3],
  triarm: [0, 2, 4],
  hexarm: [0, 1, 2, 3, 4, 5],
};

/** The twelve transforming sigils, `bind` through `void`. */
export const TRANSFORMING_SIGILS: readonly TransformingSigilKind[] = [
  "bind",
  "manifold",
  "triune",
  "sunder",
  "wane",
  "mirror",
  "ascend",
  "conjoin",
  "eclipse",
  "confluence",
  "dispersion",
  "void",
];

/** A track's cost, per cell of its path — its entry in `PART_COSTS`. */
export const TRACK_COST_PER_CELL = PART_COSTS.track;

/** The least number of cells a closed track's path holds. */
export const CLOSED_TRACK_MIN_CELLS = 3;

// ---------------------------------------------------------------------------
// The sigils (specs/sigils.md)
// ---------------------------------------------------------------------------

/** One hex of a sigil's footprint, at rotation `0`, and the role it carries. */
export interface FootprintHex {
  readonly q: number;
  readonly r: number;
  readonly role: string;
}

/**
 * Every transforming sigil's footprint at rotation `0`, in the order
 * `specs/sigils.md` tabulates it. A placed sigil's hexes are these rotated
 * about `(0, 0)` and translated onto its anchor.
 */
export const SIGIL_FOOTPRINTS: Record<
  TransformingSigilKind,
  readonly FootprintHex[]
> = {
  bind: [
    { q: 0, r: 0, role: "first" },
    { q: 1, r: 0, role: "second" },
  ],
  manifold: [
    { q: 0, r: 0, role: "center" },
    { q: 1, r: 0, role: "reach" },
    { q: -1, r: 1, role: "reach" },
    { q: 0, r: -1, role: "reach" },
  ],
  triune: [
    { q: 0, r: 0, role: "first" },
    { q: 1, r: 0, role: "second" },
  ],
  sunder: [
    { q: 0, r: 0, role: "first" },
    { q: 1, r: 0, role: "second" },
  ],
  wane: [{ q: 0, r: 0, role: "seat" }],
  mirror: [
    { q: 0, r: 0, role: "source" },
    { q: 1, r: 0, role: "target" },
  ],
  ascend: [
    { q: 0, r: 0, role: "prime" },
    { q: 1, r: 0, role: "crown" },
  ],
  conjoin: [
    { q: 0, r: 0, role: "fount" },
    { q: 1, r: 0, role: "fount" },
    { q: 0, r: 1, role: "crown" },
  ],
  eclipse: [
    { q: 0, r: 0, role: "fount" },
    { q: 1, r: 0, role: "fount" },
    { q: 0, r: 1, role: "umbral-crown" },
    { q: 1, r: -1, role: "lumen-crown" },
  ],
  confluence: [
    { q: 0, r: 0, role: "crown" },
    { q: 1, r: 0, role: "fount" },
    { q: 0, r: 1, role: "fount" },
    { q: -1, r: 0, role: "fount" },
    { q: 0, r: -1, role: "fount" },
  ],
  dispersion: [
    { q: 0, r: 0, role: "fount" },
    { q: 1, r: 0, role: "nebula-crown" },
    { q: 0, r: 1, role: "comet-crown" },
    { q: -1, r: 0, role: "nova-crown" },
    { q: 0, r: -1, role: "meteor-crown" },
  ],
  void: [
    { q: 0, r: 0, role: "maw" },
    { q: 1, r: 0, role: "rim" },
    { q: 0, r: 1, role: "rim" },
    { q: -1, r: 1, role: "rim" },
    { q: -1, r: 0, role: "rim" },
    { q: 0, r: -1, role: "rim" },
    { q: 1, r: -1, role: "rim" },
  ],
};

/**
 * The four waves of the sigil phase, in the order they run at every boundary
 * (specs/simulation.md "The sigil phase").
 */
export const SIGIL_WAVES: readonly (readonly TransformingSigilKind[])[] = [
  [
    "wane",
    "mirror",
    "ascend",
    "conjoin",
    "eclipse",
    "confluence",
    "dispersion",
  ],
  ["bind", "manifold", "triune"],
  ["sunder"],
  ["void"],
];

// ---------------------------------------------------------------------------
// The instructions (specs/instructions.md)
// ---------------------------------------------------------------------------

/** The only two instructions a wheel executes. */
export const WHEEL_INSTRUCTIONS: readonly Instruction[] = [
  "rotate-cw",
  "rotate-ccw",
];

/** The instruction each tape-focus action writes at the cursor. */
export const INSTRUCTION_ACTIONS: Record<string, Instruction> = {
  "ins-rotate-ccw": "rotate-ccw",
  "ins-rotate-cw": "rotate-cw",
  "ins-extend": "extend",
  "ins-retract": "retract",
  "ins-pivot-ccw": "pivot-ccw",
  "ins-pivot-cw": "pivot-cw",
  "ins-grab": "grab",
  "ins-drop": "drop",
  "ins-advance": "advance",
  "ins-recede": "recede",
};

// ---------------------------------------------------------------------------
// The audio cues (specs/ui.md "Audio")
// ---------------------------------------------------------------------------

/** Every cue, in the order `specs/ui.md` tabulates them. */
export const CUE_NAMES: readonly Cue[] = [
  "place",
  "erase",
  "start",
  "halt",
  "constellation",
  "complete",
  "music",
];

// ---------------------------------------------------------------------------
// What each screen reads (specs/controls.md)
// ---------------------------------------------------------------------------

/**
 * Which set of actions the game answers. The editor's three rows are keyed by
 * the situation it is in, since the editor is one screen answering three sets
 * of keys.
 */
export type ActionContext =
  | Exclude<Screen, "editor">
  | "editor-editing"
  | "editor-running"
  | "editor-halted";

/** The actions each context answers; an action a row omits does nothing. */
export const SCREEN_ACTIONS: Record<ActionContext, readonly Action[]> = {
  title: ["up", "down", "confirm", "mute"],
  howto: ["left", "right", "confirm", "back", "mute"],
  select: ["up", "down", "confirm", "back", "mute"],
  "editor-editing": [
    "up",
    "down",
    "left",
    "right",
    "part-cw",
    "part-ccw",
    "part-grow",
    "part-shrink",
    "part-delete",
    "ins-rotate-ccw",
    "ins-rotate-cw",
    "ins-extend",
    "ins-retract",
    "ins-pivot-ccw",
    "ins-pivot-cw",
    "ins-grab",
    "ins-drop",
    "ins-advance",
    "ins-recede",
    "ins-blank",
    "ins-erase",
    "ins-reset",
    "ins-repeat",
    "undo",
    "redo",
    "play",
    "step",
    "back",
    "mute",
  ],
  "editor-running": ["play", "step", "speed-up", "speed-down", "back", "mute"],
  "editor-halted": ["up", "down", "confirm", "back", "mute"],
};

/**
 * The actions the editor still reads while a drag or a lay is live
 * (specs/editor.md "Dragging").
 */
export const DRAG_ACTIONS: readonly Action[] = [
  "part-cw",
  "part-ccw",
  "part-grow",
  "part-shrink",
  "mute",
];
