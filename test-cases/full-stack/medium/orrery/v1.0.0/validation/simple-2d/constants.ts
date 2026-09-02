// Orrery — every figure the specification fixes. CASE-PROVIDED, and the SAME FILE
// in all three engine projects.
//
// WHY THE CASE CARRIES ITS OWN COPY. Under an engine the build is seeded with
// `src/constants.ts`, and a validator could import the figures from there. Under
// NO engine it is seeded with nothing at all: the run seeds no `src/`, so the
// build wrote its own constants module wherever it liked, under whatever names it
// chose. Orrery's rule is that a suite deciding one review item is the SAME TEXT
// under all three engines, so `../constants` has to resolve to the same names in
// all three projects — which means the case owns them.
//
// It also means a validator measures a build against the SPECIFICATION rather
// than against the build's own idea of a figure. Every value below is quoted from
// `specs/`; the seeded `src/constants.ts` an engine build is given is the same
// quotation, handed to the build rather than to the check.
//
// Every gameplay value is in the fixed 1280x720 logical coordinate space defined
// by `specs/overview.md` (origin top-left, x right, y down). Every canvas size is
// in pixels, and a sprite is drawn at one unit per pixel, so a canvas `44` wide
// stands `44` units wide in the world.
//
// The one fixed set of challenge data — the ten Extras — lives in `challenges.ts`
// beside this file, transcribed from `specs/challenges.md`, which is
// authoritative for it. The campaign's challenges are the build's own and no
// figure here describes them.
// ---- Stage ---------------------------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The stage center. */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

// ---- Field geometry (specs/field.md) -------------------------------------

/** The distance between adjacent hex centers. */
export const HEX_PITCH = 48;

/**
 * The stage position of hex (0, 0). A hex's center is
 *
 *   hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)
 *   hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r
 */
export const FIELD_CX = 616;
export const FIELD_CY = 304;

/**
 * The field is the hexagonal region of radius FIELD_R around (0, 0):
 * max(|q|, |r|, |q + r|) <= FIELD_R. That is 91 hexes.
 */
export const FIELD_R = 5;

/**
 * The pointer targets the nearest field hex center within this radius, ties
 * resolved by smaller r then smaller q, and no hex beyond it.
 */
export const HEX_HIT_R = 26;

/**
 * The six neighbor offsets [dq, dr], indexed 0..5 clockwise on the stage from
 * east: E, SE, SW, W, NW, NE. Rotating a direction clockwise adds 1 modulo 6.
 * Rotating an offset about (0, 0): clockwise (q, r) -> (-r, q + r),
 * counterclockwise (q, r) -> (q + r, -q).
 */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

// ---- Motes (specs/field.md) ----------------------------------------------

/** Every mote type. */
export const MOTES = [
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
] as const;

export type MoteName = (typeof MOTES)[number];

/** The four essences, in the order dispersion and confluence name them. */
export const ESSENCES = ["nebula", "comet", "nova", "meteor"] as const;

/** The planetary ladder, in ascending order. Ascension climbs toward sol. */
export const PLANETS = [
  "saturn",
  "jupiter",
  "mars",
  "venus",
  "luna",
  "sol",
] as const;

/** Every mote's drawn form fits inside this radius of its position. */
export const MOTE_R = 22;

/**
 * The collision radius: two motes collide when their centers come strictly
 * within 2 * MOTE_COLLIDE_R (38) at a sample. Below HEX_PITCH, so resting
 * adjacency never collides.
 */
export const MOTE_COLLIDE_R = 19;

/**
 * Collision is evaluated at the sample fractions t = k / COLLISION_SAMPLES for
 * k = 1..COLLISION_SAMPLES of every cycle's motion (specs/simulation.md).
 */
export const COLLISION_SAMPLES = 8;

/**
 * The sample fraction t = k / COLLISION_SAMPLES the collision rule evaluates at,
 * for k = 1..COLLISION_SAMPLES (specs/simulation.md "Collision").
 *
 * A run that faulted on sample k reports this as sim.fraction: "a `collision`
 * leaves the fraction at that sample's `k / 8`".
 */
export function sampleFraction(k: number): number {
  return k / COLLISION_SAMPLES;
}

/**
 * How near a read of sim.fraction must land on the figure the specification
 * names.
 *
 * sim.fraction is one of the three figures specs/instrumentation.md carries "as
 * running sums of the frames' own delta times", which "agree to within the
 * rounding of that sum rather than bit for bit". A tolerance this tight still
 * separates one collision sample from the next, which are an eighth apart.
 *
 * SO sim.fraction IS NEVER READ FOR EQUALITY, AND THAT INCLUDES READING IT
 * AGAINST 0. The figure a fault or a completed boundary leaves behind is the
 * same running sum: "every other fault and completion leaves it at `0`" and a
 * completed cycle leaves "the excess" are both statements about a number a
 * build accumulated frame by frame, so a build that lands on -1.4e-17 rather
 * than on a literal zero has met the requirement. Every read of sim.fraction
 * goes through assertNear with this span.
 */
export const FRACTION_TOLERANCE = 1e-6;

// ---- Parts (specs/parts.md) ----------------------------------------------

/**
 * Every part kind, in the order the tray lists permitted kinds in
 * (specs/editor.md).
 */
export const PARTS = [
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
] as const;

export type PartName = (typeof PARTS)[number];

/** Arm and piston lengths, inclusive on both ends. */
export const ARM_MIN_LEN = 1;
export const ARM_MAX_LEN = 3;

/**
 * The zodiac wheel's fixture ring at rotation 0, by spoke direction 0..5. The
 * wheel's rotation turns the ring: the fixture on spoke d is the entry at
 * (d - rotation) modulo 6.
 */
export const WHEEL_MOTES: readonly MoteName[] = [
  "nebula",
  "comet",
  "nova",
  "meteor",
  "dust",
  "dust",
];

/**
 * Part costs (specs/parts.md). A track costs its entry per cell. Cost is a
 * metric, never a budget.
 */
export const PART_COSTS: Readonly<Record<PartName, number>> = {
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

// ---- Instructions (specs/instructions.md) --------------------------------

/** The ten instructions a tape cell may hold; a blank cell holds null. */
export const INSTRUCTIONS = [
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
] as const;

export type InstructionName = (typeof INSTRUCTIONS)[number];

// ---- Simulation (specs/simulation.md) ------------------------------------

/** The run clock's steps, in cycles per second, indexed by the speed setting. */
export const SPEEDS = [1, 3, 10, 30] as const;

/** The speed index a run starts at. */
export const DEFAULT_SPEED_INDEX = 1;

/** Every fault kind, as the fault display and the snapshot name them. */
export const FAULTS = [
  "collision",
  "torn",
  "overextended",
  "overretracted",
  "unmounted",
  "track-end",
  "impossible",
] as const;

export type FaultName = (typeof FAULTS)[number];

/** The tally every set must reach for the run to complete. */
export const CONSTELLATION_TARGET = 6;

/** The fewest chained copies a repeating set accepts (specs/sigils.md). */
export const REPEAT_MIN = 2;

// ---- Challenge and solution formats (specs/formats.md) -------------------

/** The longest a challenge's name runs, in characters. The shortest is one. */
export const NAME_MAX = 32;

// ---- Modes (specs/modes/campaign.md, specs/modes/extras.md) --------------

/** The campaign's course holds between these many challenges, inclusive. */
export const CAMPAIGN_MIN = 8;
export const CAMPAIGN_MAX = 16;

/**
 * The bounds difficulty rises between: challenge 1's reference solution places
 * at most CAMPAIGN_OPENER_PARTS parts, and the last challenge's places at least
 * CAMPAIGN_FINALE_PARTS.
 */
export const CAMPAIGN_OPENER_PARTS = 3;
export const CAMPAIGN_FINALE_PARTS = 8;

/**
 * A challenge's reference solution completes its run within this many cycles
 * of the run's start.
 */
export const CAMPAIGN_REFERENCE_CYCLES = 600;

/** The Extras shelf, laid out in specs/challenges.md. */
export const EXTRA_COUNT = 10;

// ---- Editor geometry (specs/editor.md) -----------------------------------

/** The heading strip spans y 0..HEADING_H across the stage. */
export const HEADING_H = 48;

/** The tray region spans x 0..TRAY_REGION_W below the heading. */
export const TRAY_REGION_W = 224;

/** The readout region spans x READOUT_X0..STAGE_W between heading and tape. */
export const READOUT_X0 = 1008;

/**
 * Tray slot k occupies x TRAY_X0..TRAY_X0+TRAY_W,
 * y TRAY_Y0 + k * TRAY_SLOT_H .. TRAY_Y0 + (k + 1) * TRAY_SLOT_H.
 */
export const TRAY_X0 = 8;
export const TRAY_Y0 = 56;
export const TRAY_SLOT_H = 30;
export const TRAY_W = 208;

/** A challenge's derived tray holds at most this many entries. */
export const TRAY_MAX = 16;

/** The tape panel spans x TRAY_REGION_W..STAGE_W, y TAPE_Y0..STAGE_H. */
export const TAPE_Y0 = 560;

/** Row and cell geometry within the tape panel. */
export const TAPE_ROW_H = 28;
export const TAPE_ROWS_VISIBLE = 5;
export const TAPE_LABEL_W = 80;
/** Cell columns begin at stage x TRAY_REGION_W + TAPE_X0. */
export const TAPE_X0 = 88;
export const TAPE_CELL_W = 24;
export const TAPE_COLS_VISIBLE = 40;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "ORRERY";
export const TAGLINE_TEXT = "SET THE HEAVENS TURNING";

/** The title menu, in this order. It is the only place a mode is chosen. */
export const TITLE_ITEMS = ["CAMPAIGN", "EXTRAS", "HOW TO PLAY"] as const;

/** The how-to's page count; the topics per page are in specs/ui.md. */
export const HOWTO_PAGES = 5;

/**
 * The solved panel: its heading and its full menu, in this order. NEXT
 * CHALLENGE is offered only when the mode has a next challenge.
 */
export const SOLVED_TITLE_TEXT = "CHALLENGE COMPLETE";
export const SOLVED_ITEMS = [
  "NEXT CHALLENGE",
  "KEEP TINKERING",
  "BACK TO SELECT",
] as const;

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * Orrery's editor is worked with the pointer, so the keyboard drives menus and
 * the editing verbs: a four-way pad and the menu vocabulary that comes with
 * it, plus the game's own actions.
 */
export const LAYOUT = "dpad-4";

/**
 * Every action Orrery registers: the layout's four movement actions, the menu
 * vocabulary, the global verbs, and the focus-routed field and tape verbs.
 * `pause` is not registered; `back` leaves a run rather than pausing it.
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "mute",
  "play",
  "step",
  "speed-down",
  "speed-up",
  "undo",
  "redo",
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
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a
 * binding is a physical key rather than a layout-dependent character.
 *
 * Two focus-routed actions may share a code — `part-grow`/`ins-extend` on KeyW
 * and `part-shrink`/`ins-retract` on KeyS — because the game reads only the
 * actions the current focus names (specs/controls.md). Every same-focus pair
 * is distinct.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
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

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The seven cue names, one per event. Define and play exactly these. */
export const CUES = {
  place: "place",
  erase: "erase",
  start: "start",
  halt: "halt",
  constellation: "constellation",
  complete: "complete",
  music: "music",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

/** The one cue that loops until stopped rather than playing once. */
export const LOOPING_CUES: readonly CueName[] = ["music"];

// ---- The produced assets (specs/assets.md) -------------------------------
//
// Every produced file this build loads, as a path under the engine's asset root
// (`assets/`), with the canvas and frame count each is authored at. The files
// themselves do not exist yet: this build produces them with the generation
// tools on the `PATH` and commits them here. Every canvas below is in pixels;
// each sprite is drawn at that same size in logical units.

/** One sprite per mote type, drawn centered on the mote's position. */
export const MOTE_SPRITE_PATHS: Readonly<Record<MoteName, string>> = {
  dust: "sprites/motes/dust.png",
  nebula: "sprites/motes/nebula.png",
  comet: "sprites/motes/comet.png",
  nova: "sprites/motes/nova.png",
  meteor: "sprites/motes/meteor.png",
  mercury: "sprites/motes/mercury.png",
  saturn: "sprites/motes/saturn.png",
  jupiter: "sprites/motes/jupiter.png",
  mars: "sprites/motes/mars.png",
  venus: "sprites/motes/venus.png",
  luna: "sprites/motes/luna.png",
  sol: "sprites/motes/sol.png",
  umbra: "sprites/motes/umbra.png",
  lumen: "sprites/motes/lumen.png",
  aether: "sprites/motes/aether.png",
};

/** The square canvas every mote sprite is authored on. */
export const MOTE_SPRITE_SIZE = 44;

/** The two filament strips, by weight: `1` is plain and `3` is triune. */
export const FILAMENT_SPRITE_PATHS = {
  plain: "sprites/filaments/plain.png",
  triune: "sprites/filaments/triune.png",
} as const;

/** The filament strip's canvas: it spans HEX_PITCH between two mote centers. */
export const FILAMENT_SPRITE_W = 48;
export const FILAMENT_SPRITE_H = 16;

/** One glyph per transforming sigil, drawn upright on the sigil's anchor hex. */
export const SIGIL_GLYPH_PATHS = {
  bind: "sprites/sigils/bind.png",
  manifold: "sprites/sigils/manifold.png",
  triune: "sprites/sigils/triune.png",
  sunder: "sprites/sigils/sunder.png",
  wane: "sprites/sigils/wane.png",
  mirror: "sprites/sigils/mirror.png",
  ascend: "sprites/sigils/ascend.png",
  conjoin: "sprites/sigils/conjoin.png",
  eclipse: "sprites/sigils/eclipse.png",
  confluence: "sprites/sigils/confluence.png",
  dispersion: "sprites/sigils/dispersion.png",
  void: "sprites/sigils/void.png",
} as const;

/** The square canvas every sigil glyph is authored on. */
export const SIGIL_GLYPH_SIZE = 48;

/** One glyph per instruction, drawn centered in a tape cell. */
export const INSTRUCTION_GLYPH_PATHS: Readonly<
  Record<InstructionName, string>
> = {
  grab: "sprites/instructions/grab.png",
  drop: "sprites/instructions/drop.png",
  "rotate-cw": "sprites/instructions/rotate-cw.png",
  "rotate-ccw": "sprites/instructions/rotate-ccw.png",
  "pivot-cw": "sprites/instructions/pivot-cw.png",
  "pivot-ccw": "sprites/instructions/pivot-ccw.png",
  extend: "sprites/instructions/extend.png",
  retract: "sprites/instructions/retract.png",
  advance: "sprites/instructions/advance.png",
  recede: "sprites/instructions/recede.png",
};

/** The square canvas every instruction glyph is authored on, TAPE_CELL_W wide. */
export const INSTRUCTION_GLYPH_SIZE = 24;

/**
 * The two arm hubs: the arm hub is carried by `arm`, `biarm`, `triarm`, and
 * `hexarm`, the piston hub by `piston`.
 */
export const HUB_PATHS = {
  arm: "sprites/parts/hub-arm.png",
  piston: "sprites/parts/hub-piston.png",
} as const;

/** The square canvas each arm hub is authored on. */
export const HUB_SPRITE_SIZE = 40;

/** The gripper in its two states, drawn turned to its spoke's live angle. */
export const GRIPPER_PATHS = {
  open: "sprites/parts/gripper-open.png",
  closed: "sprites/parts/gripper-closed.png",
} as const;

/** The square canvas each gripper sprite is authored on. */
export const GRIPPER_SPRITE_SIZE = 32;

/** The wheel's hub, and the mount drawn under each of its fixtures. */
export const WHEEL_HUB_PATH = "sprites/parts/wheel-hub.png";
export const FIXTURE_MOUNT_PATH = "sprites/parts/fixture-mount.png";

/** The square canvas the wheel hub and the fixture mount share. */
export const WHEEL_SPRITE_SIZE = 48;

/** The two aperture sheets, as the directory each one's frames sit in. */
export const APERTURE_SHEETS = {
  rise: "sprites/apertures/rise",
  set: "sprites/apertures/set",
} as const;

/** The frames each aperture sheet holds, numbered `0` to `APERTURE_FRAMES - 1`. */
export const APERTURE_FRAMES = 6;

/** The square canvas every aperture frame is authored on. */
export const APERTURE_SPRITE_SIZE = 48;

/** The seconds one aperture frame is shown. */
export const APERTURE_FRAME_TIME = 0.12;

/** The produced particle systems, played through the particle runtime. */
export const PARTICLE_PATHS = {
  deliver: "particles/deliver.json",
  fault: "particles/fault.json",
  complete: "particles/complete.json",
} as const;

/** The one file per cue name, the music bed included. */
export const CUE_PATHS: Readonly<Record<CueName, string>> = {
  place: "audio/place.wav",
  erase: "audio/erase.wav",
  start: "audio/start.wav",
  halt: "audio/halt.wav",
  constellation: "audio/constellation.wav",
  complete: "audio/complete.wav",
  music: "audio/music.wav",
};

/** The music bed's portable score, committed beside the bed. */
export const MUSIC_SCORE_PATH = "audio/music.mid";

/** The least the music bed runs, in seconds. */
export const MUSIC_MIN_SECONDS = 30;

/**
 * The most a loop's last sample may differ from its first, in each channel, as
 * a fraction of full scale.
 */
export const LOOP_SEAM_TOLERANCE = 0.01;

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const ORRERY_DEBUG_VERSION = 1;

// ---- What the case adds beyond the seeded copy ---------------------------
//
// Two kinds of figure live here and not in a build's `src/constants.ts`: the
// engineless handle, which only an engineless build installs, and the readings a
// VALIDATOR needs that no build does.

/**
 * The page global an engineless build installs its debug surface on
 * (`specs/instrumentation.md`: `window.__orrery`).
 *
 * Present in all three projects so the constant means one thing wherever it is
 * read; only `validation/none/harness.ts` has anything to do with it, because
 * under an engine the surface is reached off `engine.debug` and nothing is
 * installed on the page.
 */
export const ORRERY_SURFACE_KEY = "__orrery";

/**
 * The key that shows and hides the debug overlay
 * (`specs/instrumentation.md`: `KeyboardEvent.code` `Backquote`).
 *
 * Not an action of `ACTIONS`: the overlay belongs to the runtime layer under an
 * engineless build and to the engine under either engine, so it is bound outside
 * the game's own registry in every case.
 */
export const OVERLAY_KEY = "Backquote";

/**
 * A key bound to no action of `BINDINGS`, on any screen, under any focus.
 *
 * What the engineless harness presses to give the page a genuine, browser-trusted
 * gesture so the build's audio context can open. `specs/controls.md` fixes the
 * whole binding table and `KeyO` is not in it, so pressing it is inert by
 * specification rather than by an accident of the reference.
 */
export const INERT_KEY = "KeyO";

/**
 * The instructions a wheel can perform (`specs/instructions.md`). Every other
 * non-blank instruction on a wheel's tape faults the run as `impossible`.
 */
export const WHEEL_INSTRUCTIONS: readonly InstructionName[] = [
  "rotate-cw",
  "rotate-ccw",
];

/**
 * The twelve transforming sigils, in `PARTS` order: `bind` through `void`
 * (`specs/parts.md`). `rise` and `set` are the other two sigils and are not
 * here, because neither carries a produced glyph and neither is placed by
 * `placePart`.
 */
export const TRANSFORMING_SIGILS = [
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
] as const;

export type SigilName = (typeof TRANSFORMING_SIGILS)[number];

/**
 * The five arm kinds — every mechanism with a base, a length, and grippers on
 * spokes (`specs/parts.md`). A `wheel` is a mechanism but not an arm: it carries
 * no length of its own and no gripper.
 */
export const ARM_KINDS = [
  "arm",
  "biarm",
  "triarm",
  "hexarm",
  "piston",
] as const;

export type ArmName = (typeof ARM_KINDS)[number];

/** The part kinds that carry a tape: the arms and the wheel (`specs/state.md`). */
export const TAPED_KINDS: readonly PartName[] = [...ARM_KINDS, "wheel"];

/** The four screens (`specs/ui.md`). */
export const SCREENS = ["title", "howto", "select", "editor"] as const;

export type ScreenName = (typeof SCREENS)[number];

/** The two courses (`specs/ui.md`). */
export const MODES = ["campaign", "extras"] as const;

export type ModeName = (typeof MODES)[number];

/** The four sim statuses (`specs/simulation.md`). */
export const SIM_STATUSES = [
  "running",
  "paused",
  "faulted",
  "complete",
] as const;

export type SimStatusName = (typeof SIM_STATUSES)[number];

/** The two editor focuses (`specs/controls.md`). */
export const FOCUSES = ["field", "tape"] as const;

export type FocusName = (typeof FOCUSES)[number];

/** The three metrics a completed run records (`specs/simulation.md`). */
export const METRICS = ["cost", "cycles", "area"] as const;

export type MetricName = (typeof METRICS)[number];

/**
 * The two filament weights (`specs/field.md`): a plain filament and the triune
 * one `specs/sigils.md`'s `triune` creates.
 */
export const FILAMENT_WEIGHTS = [1, 3] as const;

/**
 * How many frames one whole cycle is driven over by default.
 *
 * The SUITE's choice, not the game's: `specs/simulation.md` fixes no timestep at
 * all — a run advances by `SPEEDS[sim.speed] * dt` cycles and "an interval of
 * game time reaches the same state however it was divided into frames"
 * (`specs/instrumentation.md`) — so a suite may divide a cycle however it likes
 * and a conforming build lands in the same place. Twelve is chosen so every one
 * of the eight collision sample fractions `k / 8` lands on a frame boundary at a
 * whole number of frames only when the division is a multiple of 8; it is not,
 * deliberately, so nothing in a default drive can accidentally align a reading
 * with a sample. A check that is ABOUT the division states its own.
 */
export const FRAMES_PER_CYCLE = 12;

/** The rate the suites step at, in frames of simulated time per second. */
export const TICK_HZ = 60;

/** The collision threshold, in logical units: two motes closer than this collide. */
export const COLLIDE_DISTANCE = 2 * MOTE_COLLIDE_R;

/** The sample fractions collision is evaluated at, `k / 8` for `k` of `1..8`. */
export const COLLISION_FRACTIONS: readonly number[] = Array.from(
  { length: COLLISION_SAMPLES },
  (_unused, k) => (k + 1) / COLLISION_SAMPLES,
);
