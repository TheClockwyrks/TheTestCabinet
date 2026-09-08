// Wireworm — the shape of the game's state.
//
// `specs/state.md` leaves the shape to the build and fixes one contract over it:
// the debug surface `specs/instrumentation.md` specifies reads and poses this
// state, and `reset` returns every field below to its title-screen value. So
// this file is that contract, written out. It carries no behavior, which is what
// lets every subsystem — the worm, the foes, the discharge, the renderer, the
// surface — depend on it without depending on one another.
//
// The whole of the authoritative game is one `WirewormState`. Nothing the game
// carries from one frame to the next lives anywhere else: there is no
// module-level game state in this build and no closure over mutable data.

/** The six screens the game moves between (specs/ui.md). */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

/** The three sub-phases of the `playing` screen (specs/progression.md). */
export type Phase = "banner" | "active" | "respawn";

/** The three support foes (specs/foes.md). */
export type FoeKind = "glitch" | "dropper" | "corruptor";

/** The two side edges the level's worm and its foes enter from. */
export type Edge = "left" | "right";

/**
 * Where a rule announces a cue.
 *
 * The rules modules play cues by name as their events happen (specs/ui.md) and
 * know nothing else about audio: the runtime's bus (`src/audio-bus.ts`) is what
 * satisfies this, and a test can satisfy it with a list.
 */
export interface CueSink {
  play(cue: string): void;
}

/** One tile of the board, addressed as `specs/board.md` defines it. */
export interface Tile {
  c: number;
  r: number;
}

/**
 * One data-worm.
 *
 * `segments[0]` is the head and the last entry is the tail. `stepping` and
 * `body` are the two faculty gates the debug surface poses; both are `true` for
 * a worm the game itself brought in.
 */
export interface Worm {
  id: number;
  segments: Tile[];
  /** The horizontal heading: `+1` right, `-1` left. */
  dh: number;
  /** The vertical heading: `+1` down, `-1` up. */
  dv: number;
  diving: boolean;
  stepping: boolean;
  body: boolean;
  /** The worm's own step accumulator, in seconds (specs/worm.md). */
  stepClock: number;
}

/**
 * One foe.
 *
 * `x` and `y` are its center, `vx` and `vy` the velocity its position is
 * changing by right now. `mind` and `travel` are the two faculty gates.
 */
export interface Foe {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Whether a dropper has taken its first bolt. `false` for the other kinds. */
  hit: boolean;
  mind: boolean;
  travel: boolean;
  /** A glitch's own dart accumulator, in seconds. `0` for the other kinds. */
  dartClock: number;
}

/** One bolt in flight, its center climbing its column. */
export interface Bolt {
  id: number;
  x: number;
  y: number;
}

/** A point in the logical stage space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * One conducted link of a live discharge: the two tiles it joins, the seconds of
 * its `ARC_LIFE` that remain, and the lightning it is drawn as.
 *
 * `shape` is the polyline joining the two tile centers, fixed when the arc is
 * created and unchanged for its whole life, as `specs/discharge.md` requires. It is drawn data rather than a rule, so the
 * debug surface leaves it out of what it reports.
 */
export interface Arc {
  from: Tile;
  to: Tile;
  life: number;
  shape: Point[];
}

/** The cursor: its center, its spawn-in invulnerability, and its contact gate. */
export interface Cursor {
  x: number;
  y: number;
  /** Seconds of spawn-in invulnerability left, `0` for none. */
  invulnerable: number;
  /** Whether the contact test runs. */
  contact: boolean;
}

/**
 * The whole of the game.
 *
 * The node field is a flat `COLS * ROWS` array of charges, with {@link EMPTY}
 * for a tile holding no node: the discharge's flood and the worm's block test
 * both read neighbourhoods of it, and a dense array is the shape that makes
 * those reads a lookup rather than a search. `snapshot` turns it back into the
 * list of standing nodes the surface reports.
 */
export interface WirewormState {
  screen: Screen;
  phase: Phase;
  /** Seconds left in the current phase, counting down and resting at `0`. */
  phaseTimer: number;
  /** The highlighted item of whatever menu the current screen shows, from `0`. */
  menuIndex: number;

  score: number;
  lives: number;
  level: number;
  /** The highest level the run has opened, which the end screens report. */
  reachedLevel: number;
  /** The score the next bonus life is granted at (specs/scoring.md). */
  nextBonus: number;

  /** One charge per tile, or `EMPTY`; see `src/field.ts`. */
  field: Int8Array;
  worms: Worm[];
  foes: Foe[];
  bolts: Bolt[];
  arcs: Arc[];

  cursor: Cursor;
  /** Seconds until the cursor may fire again. */
  fireCooldown: number;

  /** Whether the level's own spawning of foes runs. */
  foeSpawning: boolean;
  /** Whether the level's and the respawn's entry of a worm runs. */
  wormEntry: boolean;
  /** The level's spawner clocks, in seconds. A clock at `0` is not yet drawn. */
  glitchTimer: number;
  corruptorTimer: number;
  dropperTimer: number;
  /**
   * The outcomes the debug surface posed for the level's draws, each `null`
   * until posed and `null` again once the entry it decided has consumed it
   * (`specs/instrumentation.md`, The level's draws).
   */
  nextWormEntry: Edge | null;
  nextGlitchEntry: Tile | null;
  nextDropperEntry: Tile | null;
  nextCorruptorEntry: Tile | null;

  /** The id the next worm, foe, or bolt takes. */
  nextId: number;
  /** Accumulated simulation time, in seconds. Every update adds its delta. */
  simTime: number;
  /** The game's readable copy of the runtime's mute bit, refreshed every update. */
  muted: boolean;
}
