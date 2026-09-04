// Gantry — the figures the harness and the validators are measured against.
// CASE-PROVIDED.
//
// A COPY, NOT AN IMPORT, AND DELIBERATELY SO. Every figure below is transcribed
// from the case's canonical constants file, which the project supplies to the
// build as `src/constants.ts` and tells it not to edit. This copy exists because
// a validator must never import the build's own module: a build that deleted,
// renamed or rewrote a constant would then break the harness — every point in the
// run left undecided — rather than fail the one item that constant backs. The
// figures are the specification's, so this file is where they live for the
// checks, and a build's copy is where they live for the game.
//
// The geometric record types are imported from `./surface` rather than declared
// again here, because the snapshot reports the same shapes and two structurally
// identical `Vec3` declarations one directory apart is exactly the drift a
// second copy invites. Everything else is verbatim.
//
// THIS FILE IS THE SAME IN ALL THREE ENGINE PROJECTS, `UNBOUND_KEY`'s note aside:
// the figures the specification fixes do not change with the runtime a build
// stands on, so a `diff` between the three copies should report nothing else.
//
// World values are in the game's own units on the right-handed frame
// `specs/world.md` defines: x and z horizontal, y up, the ground at y = 0.
// Angles are in degrees, masses in mass units, forces in force units. Screen
// values are in the fixed 1280x720 logical stage `specs/overview.md` defines.

import type { LoadClass, LoadPose, Obstacle, SiteLoad, Vec3 } from "./surface";

export type { LoadClass, LoadPose, Obstacle, SiteLoad, Vec3 };

// ---- Stage and time ------------------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/**
 * The fixed simulation rate: a run advances in whole 1/TICK_HZ-second ticks.
 */
export const TICK_HZ = 60;

// ---- The world (specs/world.md) ------------------------------------------

/** Gravity, units per second squared, along -y. */
export const GRAVITY = 10;

/** Lattice nodes sit at integer multiples of this pitch on every axis. */
export const LATTICE_PITCH = 2;

// ---- Materials (specs/structure.md) --------------------------------------

/** The strut: the general-purpose member, strong both ways. */
export const STRUT_COST_PER_UNIT = 10;
export const STRUT_MASS_PER_UNIT = 0.8;
export const STRUT_EA = 300000;
export const STRUT_CAP_TENSION = 2400;
export const STRUT_CAP_COMPRESSION = 2400;
export const STRUT_MAX_LEN = 6;

/** The cable: light, long, tension-only; slack in compression. */
export const CABLE_COST_PER_UNIT = 4;
export const CABLE_MASS_PER_UNIT = 0.15;
export const CABLE_EA = 60000;
export const CABLE_CAP_TENSION = 3600;
export const CABLE_MAX_LEN = 24;

/** The rail: the trolley's track, placed horizontal. */
export const RAIL_COST_PER_UNIT = 18;
export const RAIL_MASS_PER_UNIT = 1.2;
export const RAIL_EA = 300000;
export const RAIL_CAP_TENSION = 2400;
export const RAIL_CAP_COMPRESSION = 2400;
export const RAIL_MAX_LEN = 6;

/**
 * Buckling: a member of length L bears compression up to its compression
 * capacity times min(1, (BUCKLE_REF / L)^2).
 */
export const BUCKLE_REF = 4;

// ---- Parts (specs/structure.md) ------------------------------------------

export const RING_COST = 300;
export const RING_MASS = 20;
/** Per flange connection: the reaction magnitude the ring bears. */
export const RING_CAP = 6000;

export const TROLLEY_MASS = 15;
export const HOOK_MASS = 5;

export const COUNTERWEIGHT_MASS = 80;
export const COUNTERWEIGHT_COST = 40;

// ---- The axes (specs/program.md) -----------------------------------------

/** Slew: the arm's angle, degrees; unbounded. */
export const SLEW_MAX_RATE = 30;
export const SLEW_ACCEL = 30;

/** Trolley: distance along the track from its origin, units. */
export const TROLLEY_MAX_RATE = 4;
export const TROLLEY_ACCEL = 4;

/** Hoist: the cable length, units. */
export const HOIST_MAX_RATE = 4;
export const HOIST_ACCEL = 6;
export const HOIST_MIN = 1;
export const HOIST_MAX = 40;
/** Every run starts with the cable at this length. */
export const HOIST_START = 2;

/** Grip: the hook's yaw, degrees; unbounded. */
export const GRIP_MAX_RATE = 45;
export const GRIP_ACCEL = 90;

/** The watch speeds the run screen cycles through. */
export const RUN_SPEEDS = [1, 2, 4] as const;

// ---- Rigging (specs/rigging.md) ------------------------------------------

/** The swing's damping, per second, applied to the bob's tangential motion. */
export const SWING_DAMPING = 0.05;

/** The hoist cable snaps past this tension. */
export const HOIST_CABLE_CAP = 3000;

/**
 * attach takes the waiting load whose lift point is within this of the hook.
 */
export const ATTACH_RADIUS = 0.8;

/** The three set-down tolerances release is judged against. */
export const PLACE_POS_TOL = 0.5;
export const PLACE_YAW_TOL = 10;
export const PLACE_VEL_TOL = 0.6;

// ---- The solve (specs/statics.md) ----------------------------------------

/**
 * A factorization pivot at or below this fraction of the largest diagonal entry
 * of the supported system — what is left of the assembled matrix once the
 * support rows and columns are gone — marks the system singular: a mechanism,
 * and a collapse.
 */
export const SINGULAR_TOL = 1e-8;

// ---- The camera and picking (specs/controls.md) --------------------------

export const CAMERA_TARGET = { x: 0, y: 6, z: 0 } as const;
export const CAMERA_START_YAW = 45;
export const CAMERA_START_PITCH = 30;
export const CAMERA_START_DIST = 40;
export const CAMERA_PITCH_MIN = 10;
export const CAMERA_PITCH_MAX = 80;
export const CAMERA_DIST_MIN = 10;
export const CAMERA_DIST_MAX = 80;
/** Key orbit, degrees per second; zoom, units per second. */
export const ORBIT_KEY_RATE = 90;
export const ZOOM_RATE = 20;
/** Pointer-drag orbit, degrees per logical pixel. */
export const ORBIT_PER_PX = 0.25;

/** A press that moves less than this before release is a click. */
export const CLICK_SLOP = 6;
/** Screen-distance pick radii, logical pixels. */
export const NODE_PICK_PX = 20;
export const MEMBER_PICK_PX = 12;

// ---- Input (specs/controls.md) -------------------------------------------

/**
 * The menus are keyboard-driven and the pointer works the 3D scene, so the
 * keyboard layout is the four-way pad and the menu vocabulary that comes with
 * it. A layout fixes a vocabulary rather than a set of bindings: ACTIONS below
 * registers the names of that vocabulary Gantry speaks, and `pause`, which
 * Gantry has no screen for, is left unregistered.
 */
export const LAYOUT = "dpad-4";

/** Every action Gantry registers. */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "zoom-in",
  "zoom-out",
  "confirm",
  "back",
  "tool-strut",
  "tool-cable",
  "tool-rail",
  "tool-ring",
  "tool-counterweight",
  "tool-delete",
  "undo",
  "check",
  "program",
  "build",
  "run",
  "speed",
  "mute",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a
 * binding is a physical key rather than a layout-dependent character. These
 * are exactly the bindings `specs/controls.md` fixes.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  "zoom-in": ["Equal"],
  "zoom-out": ["Minus"],
  confirm: ["Enter"],
  back: ["Escape"],
  "tool-strut": ["Digit1"],
  "tool-cable": ["Digit2"],
  "tool-rail": ["Digit3"],
  "tool-ring": ["Digit4"],
  "tool-counterweight": ["Digit5"],
  "tool-delete": ["Digit6"],
  undo: ["KeyZ"],
  check: ["KeyC"],
  program: ["KeyP"],
  build: ["KeyB"],
  run: ["KeyG"],
  speed: ["KeyS"],
  mute: ["KeyM"],
};

// ---- Screens and copy (specs/ui.md) --------------------------------------

export const TITLE_TEXT = "GANTRY";
export const TAGLINE_TEXT = "RIG THE CRANE. RUN THE TAPE.";
export const TITLE_ITEMS = ["SITES", "HOW TO PLAY"] as const;

export const CLEARED_TEXT = "SITE CLEARED";
export const RESULTS_ITEMS = ["NEXT SITE", "REPLAY", "SITE SELECT"] as const;

/** The failure copy, keyed by the causes `specs/statics.md` fixes. */
export const FAIL_TEXT = {
  collapse: "THE STRUCTURE COLLAPSED",
  "ring-overload": "THE SLEW RING GAVE WAY",
  "cable-snap": "THE HOIST CABLE SNAPPED",
  "structure-struck-obstacle": "THE CRANE STRUCK AN OBSTACLE",
  "load-struck-obstacle": "THE LOAD STRUCK AN OBSTACLE",
  "load-struck-ground": "THE LOAD STRUCK THE GROUND",
  "attach-missed": "NOTHING TO ATTACH",
  "release-misplaced": "THE LOAD WAS DROPPED",
  "command-out-of-range": "A COMMAND WAS OUT OF RANGE",
  "loads-unplaced": "THE TAPE ENDED WITH LOADS UNPLACED",
} as const;

// ---- Audio (specs/ui.md) -------------------------------------------------

/** The cues; `motor` is the one loop. */
export const CUES = [
  "place",
  "delete",
  "run-start",
  "attach",
  "placed",
  "creak",
  "break",
  "collapse",
  "complete",
  "fail",
  "motor",
] as const;

export type CueName = (typeof CUES)[number];

/**
 * The creak plays when a utilization first reaches this, at most once per
 * cooldown in run-clock seconds (specs/ui.md).
 */
export const CREAK_THRESHOLD = 0.8;
export const CREAK_COOLDOWN = 0.5;

// ---- The sites (specs/sites.md) ------------------------------------------

/** The number of sites, which the site select lists in order. */
export const SITE_COUNT = 6;

/** The six site names, in that order. */
export const SITE_NAMES = [
  "First Lift",
  "Turnabout",
  "Over the Wall",
  "Long Reach",
  "High Shelf",
  "Heavy Haul",
] as const;

/** An inclusive range on one axis. */
export interface AxisRange {
  readonly min: number;
  readonly max: number;
}

/** A build envelope: the inclusive range it spans on each axis. */
export interface Envelope {
  readonly x: AxisRange;
  readonly y: AxisRange;
  readonly z: AxisRange;
}

/**
 * Each class's box, as width by height by depth at yaw 0 (`specs/world.md`).
 */
export const LOAD_CLASS_DIMENSIONS: Readonly<Record<LoadClass, Vec3>> = {
  crate: { x: 2, y: 2, z: 2 },
  container: { x: 4, y: 2, z: 2 },
  drum: { x: 2, y: 3, z: 2 },
};

/** A site's par: the cost and the time a clear's score is shown beside. */
export interface Par {
  readonly cost: number;
  readonly time: number;
}

/**
 * One site: the envelope the crane is built inside, the ground nodes it is
 * anchored to, the cost it is held to, the par, the loads to deliver, and the
 * obstacles in the way.
 */
export interface Site {
  readonly envelope: Envelope;
  readonly anchors: readonly Vec3[];
  readonly budget: number;
  readonly par: Par;
  readonly loads: readonly SiteLoad[];
  /** Empty on a site that carries none. */
  readonly obstacles: readonly Obstacle[];
}

/** The six sites, in the order `SITE_NAMES` names them. */
export const SITES: readonly Site[] = [
  // First Lift
  {
    envelope: {
      x: { min: -8, max: 12 },
      y: { min: 0, max: 16 },
      z: { min: -8, max: 12 },
    },
    anchors: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ],
    budget: 3000,
    par: { cost: 2400, time: 18 },
    loads: [
      {
        class: "crate",
        mass: 40,
        from: { x: 10, y: 2, z: 0, yaw: 0 },
        to: { x: 0, y: 2, z: 10, yaw: 0 },
      },
    ],
    obstacles: [],
  },
  // Turnabout
  {
    envelope: {
      x: { min: -10, max: 12 },
      y: { min: 0, max: 16 },
      z: { min: -10, max: 12 },
    },
    anchors: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ],
    budget: 3600,
    par: { cost: 2400, time: 55 },
    loads: [
      {
        class: "crate",
        mass: 40,
        from: { x: 9, y: 2, z: 0, yaw: 0 },
        to: { x: -7, y: 2, z: 0, yaw: 0 },
      },
      {
        class: "crate",
        mass: 60,
        from: { x: 0, y: 2, z: 9, yaw: 0 },
        to: { x: 0, y: 2, z: -7, yaw: 0 },
      },
    ],
    obstacles: [],
  },
  // Over the Wall
  {
    envelope: {
      x: { min: -10, max: 12 },
      y: { min: 0, max: 18 },
      z: { min: -8, max: 8 },
    },
    anchors: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ],
    budget: 4000,
    par: { cost: 3550, time: 40 },
    loads: [
      {
        class: "crate",
        mass: 50,
        from: { x: 9, y: 2, z: 0, yaw: 0 },
        to: { x: -5, y: 2, z: 0, yaw: 0 },
      },
    ],
    obstacles: [{ min: { x: 5, y: 0, z: -6 }, size: { x: 1, y: 8, z: 12 } }],
  },
  // Long Reach
  {
    envelope: {
      x: { min: -10, max: 20 },
      y: { min: 0, max: 20 },
      z: { min: -8, max: 8 },
    },
    anchors: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ],
    budget: 5600,
    par: { cost: 5250, time: 47 },
    loads: [
      {
        class: "container",
        mass: 90,
        from: { x: 6, y: 2, z: -6, yaw: 0 },
        to: { x: 14, y: 2, z: 6, yaw: 90 },
      },
    ],
    obstacles: [],
  },
  // High Shelf
  {
    envelope: {
      x: { min: -12, max: 12 },
      y: { min: 0, max: 18 },
      z: { min: -8, max: 8 },
    },
    anchors: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ],
    budget: 4800,
    par: { cost: 4200, time: 101 },
    loads: [
      {
        class: "container",
        mass: 80,
        from: { x: 8, y: 2, z: 0, yaw: 0 },
        to: { x: -7, y: 8, z: 0, yaw: 90 },
      },
      {
        class: "crate",
        mass: 40,
        from: { x: 8, y: 2, z: -5, yaw: 0 },
        to: { x: -7, y: 2, z: 4, yaw: 0 },
      },
    ],
    obstacles: [{ min: { x: -9, y: 0, z: -2 }, size: { x: 4, y: 6, z: 4 } }],
  },
  // Heavy Haul
  {
    envelope: {
      x: { min: -10, max: 18 },
      y: { min: 0, max: 20 },
      z: { min: -8, max: 8 },
    },
    anchors: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
      { x: 4, y: 0, z: 2 },
      { x: 0, y: 0, z: 4 },
      { x: 2, y: 0, z: 4 },
      { x: 4, y: 0, z: 4 },
    ],
    budget: 6000,
    par: { cost: 4750, time: 107 },
    loads: [
      {
        class: "drum",
        mass: 120,
        from: { x: 7, y: 3, z: 0, yaw: 0 },
        to: { x: -7, y: 3, z: 0, yaw: 0 },
      },
      {
        class: "crate",
        mass: 30,
        from: { x: 14, y: 2, z: 4, yaw: 0 },
        to: { x: -4, y: 2, z: -6, yaw: 0 },
      },
    ],
    obstacles: [],
  },
];

// ---- Produced assets (specs/assets.md) -----------------------------------

/**
 * The one root every produced model and sound is committed under and loaded
 * from. The engine resolves each asset path under it, relative to the page, so
 * the built site loads its own files at any base path.
 */
export const ASSET_ROOT = "assets/";

/** Voxel models are sculpted at eight voxels to the world unit. */
export const VOXELS_PER_UNIT = 8;

// ---- Instrumentation (specs/instrumentation.md) --------------------------

export const GANTRY_DEBUG_VERSION = 1;

// ---- Figures the validators need that the build does not ------------------

/**
 * A key no binding in `BINDINGS` uses, so pressing it operates nothing.
 *
 * The same figure the engineless project carries, for the same reason and one
 * more. The first is the gesture: `specs/assets.md` has sound wait for "the
 * player's first interaction with the page", and under this engine the audio bus
 * opens on the first `keydown` or `pointerdown` the engine's own listener sees,
 * so a harness that wants a build's audio armed dispatches one real key event and
 * this is the key it uses. The second is that a check about an action needs a key
 * that is bound to NOTHING to tell "the game ignored a key" from "the game did
 * what that key asks". `KeyQ` appears in no row of the action table
 * `specs/controls.md` fixes, so pressing it changes no game state on any screen.
 */
export const UNBOUND_KEY = "KeyQ";
