// Orrery — the figures the specification derives rather than states.
//
// `src/constants.ts` is supplied with the project and holds every figure the
// specification FIXES. A handful of the rules are written over figures the
// specification derives instead — a sigil's footprint and the four waves of the
// sigil phase (`specs/sigils.md`), the arm kinds and their spokes and the
// classes the placement rules sort a part into (`specs/parts.md`), the two
// filament weights (`specs/field.md`), the actions each screen answers
// (`specs/controls.md`) — and those are named here, once, derived from the
// constants beside them wherever the derivation is honest.
//
// Nothing in this file contradicts `src/constants.ts`: every value below either
// reads a constant or writes out a table the specification tabulates under no
// constant name of its own.

import {
  ACTIONS,
  DIRS,
  INSTRUCTIONS,
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

// ---------------------------------------------------------------------------
// The field (specs/field.md)
// ---------------------------------------------------------------------------

/** The six neighbor offsets of `DIRS`, as axial coordinates. */
export const DIR_OFFSETS: readonly Hex[] = DIRS.map(([q, r]) => ({ q, r }));

/** A plain filament's weight (specs/field.md "Filaments and constellations"). */
export const FILAMENT_WEIGHT = 1;

/** A triune filament's weight; `triune` alone creates one (specs/sigils.md). */
export const TRIUNE_WEIGHT = 3;

// ---------------------------------------------------------------------------
// The parts (specs/parts.md)
// ---------------------------------------------------------------------------

/** The five arm kinds, which share one anatomy. */
export const ARM_KINDS: readonly ArmKind[] = [
  "arm",
  "biarm",
  "triarm",
  "hexarm",
  "piston",
];

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

/** Each arm kind's gripper spokes, as offsets from the part's rotation. */
export const ARM_SPOKE_OFFSETS: Record<ArmKind, readonly number[]> = {
  arm: [0],
  piston: [0],
  biarm: [0, 3],
  triarm: [0, 2, 4],
  hexarm: [0, 1, 2, 3, 4, 5],
};

/** A track's cost, per cell of its path (specs/parts.md). */
export const TRACK_COST_PER_CELL: number = PART_COSTS.track;

/** The least number of cells a closed track's path holds (specs/parts.md). */
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
export const INSTRUCTION_ACTIONS: Readonly<Record<string, Instruction>> =
  Object.fromEntries(
    INSTRUCTIONS.map((name) => [`ins-${name}`, name]),
  ) as Record<string, Instruction>;

// ---------------------------------------------------------------------------
// Input routing (specs/controls.md "What each screen reads")
// ---------------------------------------------------------------------------

/**
 * Which actions each screen reads. The editor's three rows are keyed by the
 * situation it is in, since the editor is one screen answering three sets of
 * keys.
 */
export type ActionContext =
  | Exclude<Screen, "editor">
  | "editor-editing"
  | "editor-running"
  | "editor-halted";

/** Every instruction-writing action, in `INSTRUCTIONS` order. */
const INSTRUCTION_KEYS: readonly ActionName[] = INSTRUCTIONS.map(
  (name) => `ins-${name}` as ActionName,
);

/** The actions each context answers; an action a row omits does nothing. */
export const SCREEN_ACTIONS: Readonly<
  Record<ActionContext, readonly ActionName[]>
> = {
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
    ...INSTRUCTION_KEYS,
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
export const DRAG_ACTIONS: readonly ActionName[] = [
  "part-cw",
  "part-ccw",
  "part-grow",
  "part-shrink",
  "mute",
];

/** Every registered action, in `ACTIONS` order. */
export const ALL_ACTIONS: readonly ActionName[] = ACTIONS;

// ---------------------------------------------------------------------------
// The produced assets (specs/assets.md)
// ---------------------------------------------------------------------------

/** One produced particle system's name. */
export type ParticleSystemName = keyof typeof PARTICLE_PATHS;

/** The three produced particle systems, in the order `specs/assets.md` lists. */
export const PARTICLE_NAMES: readonly ParticleSystemName[] = [
  "deliver",
  "fault",
  "complete",
];

/** Every cue, in the order `specs/ui.md` tabulates them. */
export const CUE_NAMES: readonly CueName[] = [
  "place",
  "erase",
  "start",
  "halt",
  "constellation",
  "complete",
  "music",
];
