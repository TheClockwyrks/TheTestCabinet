// Floe — the shape of the game's state.
//
// `specs/state.md` lists what the state must carry and leaves its shape to the
// build. This is that shape: one plain object, advanced by `src/game.ts`, read by
// `src/render.ts`, `src/diagnostics.ts` and `src/snapshot.ts`, and posed by
// `src/debug.ts`. Nothing the run keeps between ticks lives anywhere else.
//
// TWO CONVENTIONS HOLD WITHOUT EXCEPTION (specs/overview.md). A body — the
// critter, a bear, the bonus catch — carries its CENTER. A lane item is a span
// rather than a point, so it carries its LEFT EDGE and occupies
// `[x, x + TILE * len)` on its row.
//
// EVERY MOVING BODY ALSO CARRIES WHERE IT STOOD WHEN THE TICK BEGAN. The
// simulation runs at a fixed 120 Hz and a frame is presented when the display
// asks for it, so the renderer draws between two ticks (`src/render.ts`). Those
// `prev` fields are written by the tick and read only by the renderer; nothing in
// the simulation reads them back, so a posed scenario is drawn exactly as it was
// stepped.

import type { FloeKind, ItemKind, LaneDir, VehicleKind } from "./constants";

export type { FloeKind, ItemKind, LaneDir, VehicleKind };

/** The screen the game is showing (specs/ui.md). */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

/** What a crossing is doing (specs/progression.md). */
export type Phase = "crossing" | "dying" | "clearing";

/** A grid direction. */
export type Facing = "up" | "down" | "left" | "right";

/** What the critter is standing on (specs/strait.md). */
export type Footing = "solid" | "floe" | "water";

/** What took a life, which decides the cue and the effect drawn. */
export type Death = "crush" | "splash" | "caught" | "timeout";

/** The critter: one per crossing, so it carries no id. */
export interface Critter {
  /** Whether it is on the strait at all. `false` through a death's hold. */
  present: boolean;
  /** Its center, in stage units. */
  x: number;
  y: number;
  /** Its center when the current tick began. Written by the tick, read by the renderer. */
  prevX: number;
  prevY: number;
  /** The direction of its last hop. */
  facing: Facing;
  /** Seconds until it may hop again. */
  hopCooldown: number;
  /** The topmost row it has stood on this crossing. */
  bestRow: number;
}

/** One bear on the strait. */
export interface Bear {
  /** Unique among the entities live at any moment. */
  id: number;
  /** The tile it last settled on. */
  col: number;
  row: number;
  /** The tile it is travelling into; equal to `col`/`row` while it is settled. */
  stepCol: number;
  stepRow: number;
  /** Its center, in stage units. */
  x: number;
  y: number;
  /** Its center when the current tick began. */
  prevX: number;
  prevY: number;
  /** The direction of the step it is travelling on. */
  facing: Facing;
  /** The tile it is hunting. */
  target: { col: number; row: number };
  /** Whether it reads the critter's tile. */
  sense: boolean;
  /** Whether it chooses a step on settling. */
  routing: boolean;
  /** Whether it travels at all. */
  travel: boolean;
  /**
   * Travel left over from the tick that settled it on a tile center, in stage
   * units, added to the next tick's travel so no distance is lost at a center.
   */
  carry: number;
}

/** One vehicle or one floe. */
export interface LaneItem {
  /** Unique among the entities live at any moment. */
  id: number;
  /** The strait row it runs on. */
  row: number;
  /** Its kind, which fixes its length and the art it is drawn from. */
  kind: ItemKind;
  /** Its LEFT EDGE, in stage units. It occupies `[x, x + TILE * len)`. */
  x: number;
  /** Its left edge when the current tick began. */
  prevX: number;
  /** Its length, in tiles. */
  len: number;
}

/** One lane's motion, and the ring its items wrap around. */
export interface Lane {
  /** The strait row. */
  row: number;
  /** `1` rightward, `-1` leftward. */
  dir: LaneDir;
  /** Tiles per second. */
  speed: number;
  /**
   * The length of the ring the lane's items wrap around, in stage units. It is a
   * whole number of item-and-gap periods and is wider than the strait, so the
   * spacing survives the wrap unbroken.
   */
  trackLen: number;
  /** The ring's left end: an item lives in `[wrapMin, wrapMin + trackLen)`. */
  wrapMin: number;
}

/** One place in the hunt a bear can occupy. */
export interface HuntSlot {
  /** The bear filling it, or `null` while it stands empty. */
  bearId: number | null;
  /** Seconds since it fell empty. */
  emptyFor: number;
}

/**
 * What is drawn for a moment where a life was lost: the splash of a fall, the
 * spray of a crush, and the lunge of the bear that caught the critter.
 *
 * The lunge is here rather than on the bear because EVERY BEAR LEAVES THE STRAIT
 * on the tick a life is lost (specs/hunter.md), so by the time the frame is drawn
 * there is no bear left to draw it from. The picture keeps the lunge; the roster
 * does not (specs/assets.md).
 */
export interface Effect {
  /** What it is drawn as. */
  kind: "splash" | "spray" | "lunge";
  /** Its center, in stage units. */
  x: number;
  y: number;
  /** Seconds it has left. */
  life: number;
  /** Seconds it started with. */
  span: number;
}

/** The whole of the game, in one value. */
export interface FloeState {
  // ---- The screens (specs/ui.md) ----
  screen: Screen;
  /** The highlighted item of the current screen's menu, from `0`. */
  menuIndex: number;

  // ---- The crossing (specs/progression.md) ----
  phase: Phase;
  /** Seconds left in the hold currently running, `0` whenever none is. */
  phaseTimer: number;

  // ---- The run ----
  level: number;
  reachedLevel: number;
  lives: number;
  score: number;
  /** Seconds left on the crossing timer. */
  timer: number;

  // ---- The far shore (specs/bays.md) ----
  /** The five bays, `true` where filled, left to right. */
  bays: boolean[];
  /** The bay holding the bonus catch, or `null`. */
  fishBay: number | null;
  /** Seconds until the bonus catch's next transition: appearing, or leaving. */
  fishTimer: number;
  /** The bay the previous bonus catch occupied, so the next one moves on. */
  lastFishBay: number | null;

  // ---- The bodies ----
  critter: Critter;
  bears: Bear[];
  /** The hunt's slots: one below `SECOND_BEAR_LEVEL`, two from it. */
  slots: HuntSlot[];

  // ---- The two bands (specs/ice.md, specs/water.md) ----
  iceLanes: Lane[];
  waterLanes: Lane[];
  vehicles: LaneItem[];
  floes: LaneItem[];

  // ---- The world gates (specs/instrumentation.md) ----
  bearEmergence: boolean;
  catchTest: boolean;
  fishCadence: boolean;
  timerRunning: boolean;

  // ---- The clocks ----
  /** Accumulated simulation time. Every tick adds `TICK_DT`, whatever the screen. */
  simTime: number;

  // ---- The runtime's bit, kept here so the snapshot can report it ----
  /** The runtime's mute bit, refreshed from the runtime in every update. */
  muted: boolean;

  // ---- Bookkeeping ----
  /** The id the next entity added to the strait takes. */
  nextId: number;
  /** What is drawn where a critter went under. Presentational and short-lived. */
  effects: Effect[];
}
