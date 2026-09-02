// Orrery — every figure the specification fixes, named once.
//
// This build stands on no engine, so nothing outside it holds these numbers.
// Every module reads them from here: the geometry of the field and the editor,
// the rosters of motes, parts, instructions, and faults, the costs, the
// speeds, the key bindings, the screen copy, the cue names, and the produced
// assets' paths and canvases. Where a specification file states a value, the
// name below is the name that file gives it and the comment names the file.
//
// Nothing here is derived from anything else at run time: a figure the
// specification states is written out, and a figure the specification derives
// is derived where it is used.

import type {
  ArmKind,
  EssenceType,
  Hex,
  Instruction,
  MoteType,
  PartKind,
  PlanetType,
  Screen,
  TransformingSigilKind,
} from "./types";

// ---------------------------------------------------------------------------
// The stage (specs/overview.md "Coordinate system and presentation")
// ---------------------------------------------------------------------------

/** The game's logical design width. */
export const STAGE_W = 1280;
/** The game's logical design height. */
export const STAGE_H = 720;
/** The stage center's `x`. */
export const STAGE_CX = 640;
/** The stage center's `y`. */
export const STAGE_CY = 360;

// ---------------------------------------------------------------------------
// The field (specs/field.md)
// ---------------------------------------------------------------------------

/** Stage `x` of hex `(0, 0)`. */
export const FIELD_CX = 616;
/** Stage `y` of hex `(0, 0)`. */
export const FIELD_CY = 304;
/** Distance between adjacent hex centers. */
export const HEX_PITCH = 48;
/** Radius of the field, in hexes. */
export const FIELD_R = 5;
/** Pointer targeting radius around a hex center. */
export const HEX_HIT_R = 26;

/** The six neighbor offsets, clockwise on the stage starting from east. */
export const DIRS: readonly Hex[] = [
  { q: 1, r: 0 }, // 0 east
  { q: 0, r: 1 }, // 1 southeast
  { q: -1, r: 1 }, // 2 southwest
  { q: -1, r: 0 }, // 3 west
  { q: 0, r: -1 }, // 4 northwest
  { q: 1, r: -1 }, // 5 northeast
];

/** The fifteen mote types, in the order `specs/field.md` lists them. */
export const MOTES: readonly MoteType[] = [
  "dust",
  "nebula",
  "comet",
  "nova",
  "meteor",
  "mercury",
  "saturn",
  "jupiter",
  "mars",
  "venus",
  "luna",
  "sol",
  "umbra",
  "lumen",
  "aether",
];

/** The four essences, in order. */
export const ESSENCES: readonly EssenceType[] = [
  "nebula",
  "comet",
  "nova",
  "meteor",
];

/** The planetary ladder, `saturn` up to `sol`. */
export const PLANETS: readonly PlanetType[] = [
  "saturn",
  "jupiter",
  "mars",
  "venus",
  "luna",
  "sol",
];

/** A plain filament's weight (specs/field.md "Filaments and constellations"). */
export const FILAMENT_WEIGHT = 1;
/** A triune filament's weight; `triune` alone creates one (specs/sigils.md). */
export const TRIUNE_WEIGHT = 3;

/** Every mote's drawn form fits inside this radius of its position. */
export const MOTE_R = 22;
/** Two motes collide when their centers come closer than `2 * MOTE_COLLIDE_R`. */
export const MOTE_COLLIDE_R = 19;

// ---------------------------------------------------------------------------
// The parts (specs/parts.md)
// ---------------------------------------------------------------------------

/** The twenty-one part kinds, in the order the tray lists them. */
export const PARTS: readonly PartKind[] = [
  "arm",
  "biarm",
  "triarm",
  "hexarm",
  "piston",
  "wheel",
  "track",
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
  "rise",
  "set",
];

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

/** The shortest rest length an arm or piston stands at. */
export const ARM_MIN_LEN = 1;
/** The longest rest length an arm or piston stands at. */
export const ARM_MAX_LEN = 3;

/** The zodiac wheel's ring at rotation `0`, indexed by spoke. */
export const WHEEL_MOTES: readonly MoteType[] = [
  "nebula", // spoke 0
  "comet", // spoke 1
  "nova", // spoke 2
  "meteor", // spoke 3
  "dust", // spoke 4
  "dust", // spoke 5
];

/** Each part's cost; a track costs `TRACK_COST_PER_CELL` per cell. */
export const PART_COSTS: Record<PartKind, number> = {
  arm: 20,
  biarm: 30,
  triarm: 40,
  hexarm: 60,
  piston: 40,
  wheel: 30,
  track: 5,
  bind: 10,
  manifold: 30,
  triune: 20,
  sunder: 10,
  wane: 10,
  mirror: 20,
  ascend: 20,
  conjoin: 20,
  eclipse: 30,
  confluence: 20,
  dispersion: 20,
  void: 0,
  rise: 0,
  set: 0,
};

/** A track's cost, per cell of its path. */
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

/** The ten instructions a tape cell may hold. */
export const INSTRUCTIONS: readonly Instruction[] = [
  "grab",
  "drop",
  "rotate-cw",
  "rotate-ccw",
  "pivot-cw",
  "pivot-ccw",
  "extend",
  "retract",
  "advance",
  "recede",
];

/** The only two instructions a wheel executes. */
export const WHEEL_INSTRUCTIONS: readonly Instruction[] = [
  "rotate-cw",
  "rotate-ccw",
];

// ---------------------------------------------------------------------------
// The clock (specs/simulation.md "Cycles and the clock")
// ---------------------------------------------------------------------------

/** The speed steps, in cycles per second of game time. */
export const SPEEDS: readonly number[] = [1, 3, 10, 30];
/** The speed step a run starts at. */
export const DEFAULT_SPEED_INDEX = 1;
/** How many fractions of a cycle the collision rule is evaluated at. */
export const COLLISION_SAMPLES = 8;

// ---------------------------------------------------------------------------
// The editor (specs/editor.md)
// ---------------------------------------------------------------------------

/** The heading band's height. */
export const HEADING_H = 48;
/** The tray region's width; also the field's and the tape panel's left edge. */
export const TRAY_REGION_W = 224;
/** The readout region's left edge. */
export const READOUT_X0 = 1008;
/** The tape panel's top edge. */
export const TAPE_Y0 = 560;

/** The tray's first slot's left edge. */
export const TRAY_X0 = 8;
/** The tray's first slot's top edge. */
export const TRAY_Y0 = 56;
/** One tray slot's height. */
export const TRAY_SLOT_H = 30;
/** One tray slot's width. */
export const TRAY_W = 208;

/** Height of one tape row. */
export const TAPE_ROW_H = 28;
/** Tape rows shown at once. */
export const TAPE_ROWS_VISIBLE = 5;
/** Width of the label at a tape row's left edge. */
export const TAPE_LABEL_W = 80;
/** Offset from the tape panel's left edge to cell `0`'s column. */
export const TAPE_X0 = 88;
/** Width of one tape cell. */
export const TAPE_CELL_W = 24;
/** Tape cell columns shown at once. */
export const TAPE_COLS_VISIBLE = 40;

// ---------------------------------------------------------------------------
// The formats (specs/formats.md) and the modes
// ---------------------------------------------------------------------------

/** The longest a challenge's display name runs. */
export const NAME_MAX = 32;
/** The most entries a challenge's derived tray holds. */
export const TRAY_MAX = 16;
/** The fewest copies a repeating product's set accepts. */
export const REPEAT_MIN = 2;
/** The tally every set must reach; every challenge in this game uses it. */
export const CONSTELLATION_TARGET = 6;

/** How many challenges the Extras shelf holds (specs/modes/extras.md). */
export const EXTRA_COUNT = 10;
/** The fewest challenges a campaign course holds (specs/modes/campaign.md). */
export const CAMPAIGN_MIN = 8;
/** The most challenges a campaign course holds. */
export const CAMPAIGN_MAX = 16;
/** The cycles a reference solution's run must complete within. */
export const CAMPAIGN_REFERENCE_CYCLES = 600;
/** The most parts the opening challenge's reference solution places. */
export const CAMPAIGN_OPENER_PARTS = 3;
/** The fewest parts the last challenge's reference solution places. */
export const CAMPAIGN_FINALE_PARTS = 8;

// ---------------------------------------------------------------------------
// The screens (specs/ui.md)
// ---------------------------------------------------------------------------

/** The game's title. */
export const TITLE_TEXT = "ORRERY";
/** The line under the title. */
export const TAGLINE_TEXT = "SET THE HEAVENS TURNING";
/** The title menu's items, in order. */
export const TITLE_ITEMS: readonly string[] = [
  "CAMPAIGN",
  "EXTRAS",
  "HOW TO PLAY",
];
/** How many pages the how-to runs to. */
export const HOWTO_PAGES = 5;
/** The solved panel's heading. */
export const SOLVED_TITLE_TEXT = "CHALLENGE COMPLETE";
/** The solved panel's menu items, in order. */
export const SOLVED_ITEMS: readonly string[] = [
  "NEXT CHALLENGE",
  "KEEP TINKERING",
  "BACK TO SELECT",
];

// ---------------------------------------------------------------------------
// The audio cues (specs/ui.md "Audio")
// ---------------------------------------------------------------------------

/** The seven cues, under exactly the names `specs/ui.md` fixes. */
export const CUES = {
  place: "place",
  erase: "erase",
  start: "start",
  halt: "halt",
  constellation: "constellation",
  complete: "complete",
  music: "music",
} as const;

/** One cue's name. */
export type Cue = (typeof CUES)[keyof typeof CUES];

/** Every cue, in the order `specs/ui.md` tabulates them. */
export const CUE_NAMES: readonly Cue[] = [
  CUES.place,
  CUES.erase,
  CUES.start,
  CUES.halt,
  CUES.constellation,
  CUES.complete,
  CUES.music,
];

/** The one cue that loops until stopped rather than playing once. */
export const LOOPING_CUES: readonly Cue[] = [CUES.music];

// ---------------------------------------------------------------------------
// Input (specs/controls.md)
// ---------------------------------------------------------------------------

/** Every action the game registers, in the order `specs/controls.md` lists. */
export const ACTIONS = [
  // Navigation
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  // Global
  "mute",
  "play",
  "step",
  "speed-down",
  "speed-up",
  "undo",
  "redo",
  // Field focus
  "part-cw",
  "part-ccw",
  "part-grow",
  "part-shrink",
  "part-delete",
  // Tape focus
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
] as const;

/** One registered action's name. */
export type Action = (typeof ACTIONS)[number];

/** The `KeyboardEvent.code` values that fire each action. */
export const BINDINGS: Record<Action, readonly string[]> = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  confirm: ["Enter"],
  back: ["Escape"],
  mute: ["KeyM"],
  play: ["Space"],
  step: ["KeyN"],
  "speed-down": ["Comma"],
  "speed-up": ["Period"],
  undo: ["KeyU"],
  redo: ["KeyI"],
  "part-cw": ["KeyE"],
  "part-ccw": ["KeyQ"],
  "part-grow": ["KeyW"],
  "part-shrink": ["KeyS"],
  "part-delete": ["KeyX"],
  "ins-rotate-ccw": ["KeyA"],
  "ins-rotate-cw": ["KeyD"],
  "ins-extend": ["KeyW"],
  "ins-retract": ["KeyS"],
  "ins-pivot-ccw": ["KeyZ"],
  "ins-pivot-cw": ["KeyC"],
  "ins-grab": ["KeyG"],
  "ins-drop": ["KeyV"],
  "ins-advance": ["KeyT"],
  "ins-recede": ["KeyB"],
  "ins-blank": ["Delete"],
  "ins-erase": ["Backspace"],
  "ins-reset": ["KeyR"],
  "ins-repeat": ["KeyY"],
};

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

/**
 * Which actions each screen reads (specs/controls.md "What each screen
 * reads"). The editor's three rows are keyed by the situation it is in, since
 * the editor is one screen answering three sets of keys.
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

// ---------------------------------------------------------------------------
// The debug surface (specs/instrumentation.md)
// ---------------------------------------------------------------------------

/** The version the surface and the snapshot report. */
export const ORRERY_DEBUG_VERSION = 1;
/** The name the surface is installed under on the page. */
export const ORRERY_SURFACE_KEY = "__orrery";
/** The `KeyboardEvent.code` that shows and hides the debug overlay. */
export const OVERLAY_TOGGLE_CODE = "Backquote";

// ---------------------------------------------------------------------------
// The produced assets (specs/assets.md)
// ---------------------------------------------------------------------------

/** Every produced file's path is written relative to this root. */
export const ASSET_ROOT = "assets";

/** Each mote type's sprite, by name. */
export const MOTE_SPRITE_PATHS: Record<MoteType, string> = Object.fromEntries(
  MOTES.map((type) => [type, `sprites/motes/${type}.png`]),
) as Record<MoteType, string>;
/** The square canvas every mote sprite is authored and drawn at. */
export const MOTE_SPRITE_SIZE = 44;

/** The plain and triune filament strips. */
export const FILAMENT_SPRITE_PATHS = {
  plain: "sprites/filaments/plain.png",
  triune: "sprites/filaments/triune.png",
} as const;
/** The filament strip's canvas width, which spans one `HEX_PITCH`. */
export const FILAMENT_SPRITE_W = 48;
/** The filament strip's canvas height. */
export const FILAMENT_SPRITE_H = 16;

/** Each transforming sigil's engraved glyph, by kind. */
export const SIGIL_GLYPH_PATHS: Record<TransformingSigilKind, string> =
  Object.fromEntries(
    TRANSFORMING_SIGILS.map((kind) => [kind, `sprites/sigils/${kind}.png`]),
  ) as Record<TransformingSigilKind, string>;
/** The square canvas every sigil glyph is authored and drawn at. */
export const SIGIL_GLYPH_SIZE = 48;

/** Each instruction's tape glyph, by name. */
export const INSTRUCTION_GLYPH_PATHS: Record<Instruction, string> =
  Object.fromEntries(
    INSTRUCTIONS.map((name) => [name, `sprites/instructions/${name}.png`]),
  ) as Record<Instruction, string>;
/** The square canvas every instruction glyph is authored and drawn at. */
export const INSTRUCTION_GLYPH_SIZE = 24;

/** The arm and piston hubs. */
export const HUB_PATHS = {
  arm: "sprites/parts/hub-arm.png",
  piston: "sprites/parts/hub-piston.png",
} as const;
/** The square canvas both hubs are authored and drawn at. */
export const HUB_SPRITE_SIZE = 40;

/** The open and closed grippers. */
export const GRIPPER_PATHS = {
  open: "sprites/parts/gripper-open.png",
  closed: "sprites/parts/gripper-closed.png",
} as const;
/** The square canvas both grippers are authored and drawn at. */
export const GRIPPER_SPRITE_SIZE = 32;

/** The zodiac wheel's hub. */
export const WHEEL_HUB_PATH = "sprites/parts/wheel-hub.png";
/** The mount a fixture sits in. */
export const FIXTURE_MOUNT_PATH = "sprites/parts/fixture-mount.png";
/** The square canvas the hub and the mount share. */
export const WHEEL_SPRITE_SIZE = 48;

/** The two aperture sheets' directories. */
export const APERTURE_SHEETS = {
  rise: "sprites/apertures/rise",
  set: "sprites/apertures/set",
} as const;
/** How many frames each aperture sheet holds. */
export const APERTURE_FRAMES = 6;
/** The square canvas every aperture frame is authored and drawn at. */
export const APERTURE_SPRITE_SIZE = 48;
/** The seconds one aperture frame is shown. */
export const APERTURE_FRAME_TIME = 0.12;

/** The three produced particle systems, by name. */
export const PARTICLE_PATHS = {
  deliver: "particles/deliver.json",
  fault: "particles/fault.json",
  complete: "particles/complete.json",
} as const;

/** One produced particle system's name. */
export type ParticleSystemName = keyof typeof PARTICLE_PATHS;

/** Each cue's produced sound, by name, the music bed's included. */
export const CUE_PATHS: Record<Cue, string> = {
  place: "audio/place.wav",
  erase: "audio/erase.wav",
  start: "audio/start.wav",
  halt: "audio/halt.wav",
  constellation: "audio/constellation.wav",
  complete: "audio/complete.wav",
  music: "audio/music.wav",
};

/** The music bed's score, committed beside the bed it rendered. */
export const MUSIC_SCORE_PATH = "audio/music.mid";
/** The least the bed runs, in seconds. */
export const MUSIC_MIN_SECONDS = 30;
/** How far the bed's last sample may sit from its first, in full scale. */
export const LOOP_SEAM_TOLERANCE = 0.01;
