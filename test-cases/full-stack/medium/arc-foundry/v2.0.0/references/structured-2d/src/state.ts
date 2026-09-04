// Arc Foundry — the whole of the game's authoritative state, as the one live object
// the world carries.
//
// THE STATE IS A LIVE OBJECT. The game mode names `FoundryState` as its
// `gameStateClass`, so the engine builds exactly one of these when the world opens and
// hands it out as `world.state` for the life of the session (`engine/game-modes.md`).
// A tick, a controller, and a debug pose all write the fields they advance IN PLACE;
// nothing copies the state and nothing replaces it. Arc Foundry opens one level and
// never opens another, so this object outlives every screen the game shows.
//
// EVERY FIELD'S INITIALIZER IS ITS TITLE-SCREEN VALUE, and it is the same value
// `resetWorld` in `src/sim.ts` restores, so the two agree by construction: a freshly
// built state and a reset one are the same game. The one thing an initializer cannot
// state is the ground route, which is derived from the map's walls — `refreshMaze`
// computes it, from the game mode's `beginPlay` and from `createWorld` alike.
//
// TWO FIELDS ARE NOT THE GAME'S OWN. `muted` and `pointerX`/`pointerY` mirror what the
// runtime holds, refreshed every frame, and `reset` deliberately leaves them alone. So
// does `assets`: the produced files are loaded once by the game instance, which seeds
// them here when the world opens, and they survive every reset.
//
// The inherited `phase` is the ENGINE's match phase, and Arc Foundry never calls
// `setPhase`, so it rests at `"waiting"` for the whole session and `elapsed` stays `0`.
// The game's own build/wave/finale phase is `runPhase` below, and the two are unrelated.

import { GameState } from "@test-cabinet/structured-2d";
import type { World } from "@test-cabinet/structured-2d";
import { noAssets, type Assets } from "./assets";
import {
  START_CHARGE,
  START_INTEGRITY,
  type ComponentType,
  type CueName,
  type DifficultyId,
  type MapId,
  type PhaseName,
  type ScreenName,
  type Speed,
} from "./constants";
import type { Burst } from "./particles";
import { DIFFICULTY_BY_ID } from "./tables";
import type {
  FxEvent,
  Harvest,
  Projectile,
  Pt,
  Structure,
  Unit,
  Wave,
} from "./types";
import { buildWave } from "./waves";

/** The default state of the scrap-press generator, before a seed replaces it. */
export const PRESS_SEED = 0x51a6c0de;

/** What the crit generator is derived from, so the two streams never run in step. */
export const COMBAT_SALT = 0x2f9d3b17;

/**
 * The whole of Arc Foundry's state.
 *
 * Every field is declared here under its name, its type, and its meaning, so no field
 * is ever absent and no frame branches on a not-yet-built value. `reset` on the debug
 * surface restores exactly the fields `specs/instrumentation.md` names, and everything
 * else the game keeps across frames is derived from those.
 */
export class FoundryState extends GameState {
  // ---- Where the game is ----
  screen: ScreenName = "title";
  /**
   * The phase of a live run. It reads `build` off the yard, where it means nothing.
   *
   * Named apart from the inherited `phase`, which is the engine's match phase and
   * belongs to the framework rather than to this game.
   */
  runPhase: PhaseName = "build";
  /** The in-place pause. The screen stays `playing`. */
  paused = false;
  /** The highlighted entry on whichever menu is showing, counted from `0`. */
  menuIndex = 0;

  // ---- The run ----
  mapId: MapId = "substation";
  difficultyId: DifficultyId = "medium";
  charge: number = START_CHARGE;
  integrity: number = START_INTEGRITY;
  /** The highest Grid Integrity this run has held, which the bar reads against. */
  maxIntegrity: number = START_INTEGRITY;
  /** Damage tallied on the finale's Overload Dynamo. The run's one number. */
  mazeRating = 0;
  /** The post-final Overload Dynamo is walking. */
  finale = false;
  wave = 0;
  speed: Speed = 1;

  // ---- The yard ----
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  structures: Structure[] = [];

  // ---- Building ----
  /** A blank rock is on the cursor. It rolls when it lands. */
  holding = false;
  /** The primary selection, which drives the inspector and the range ring. */
  selectedId: number | null = null;
  /** The explicit combine set, the primary first. Empty when there is none. */
  combineIds: number[] = [];
  /** Rocks placed of the level's `STAMPS_PER_LEVEL` allowance. */
  stampsUsed = 0;
  refinement = 0;
  harvest: Harvest = { mode: "none" };
  /** The exact roll the surface armed for the next placed rock. */
  armedRoll: { readonly type: ComponentType; readonly quality: number } | null =
    null;

  // ---- Run tallies ----
  kills = 0;
  leakCount = 0;

  // ---- The wave schedule ----
  activeWave: Wave | null = null;
  /** The surface's hold on the spawner: a live wave with an empty schedule. */
  spawnerHeld = false;
  nextWave: Wave = buildWave(1, DIFFICULTY_BY_ID.medium);
  spawnCursor = 0;
  /** Milliseconds into the active wave. */
  waveClock = 0;

  // ---- Clocks ----
  /** The simulation clock, in seconds. Every rate and duration is measured on it. */
  simTime = 0;
  /** Unspent simulation time, in seconds, between whole fixed steps. */
  stepAcc = 0;
  /** The fraction of the next step the frame has already covered, for interpolation. */
  renderAlpha = 0;
  /** Real elapsed seconds, which drives the cycles and pulses the yard is drawn with. */
  clockTime = 0;

  // ---- Identity ----
  nextId = 1;
  /** The scrap-press generator's state: the type and quality rolls. */
  pressRng: number = PRESS_SEED;
  /** The seed `reset` set, which `startRun` restores the press to. */
  pressSeed: number = PRESS_SEED;
  /** The combat generator's state: the crit rolls. */
  combatRng: number = (PRESS_SEED ^ COMBAT_SALT) >>> 0;

  // ---- The ground route, recomputed whenever the walls move ----
  mazePath: readonly Pt[] = [];
  /** The route's length, in tiles. */
  mazeLength = 0;

  // ---- Mirrors of what the runtime owns ----
  /** The engine's mute bit, refreshed every frame. */
  muted = false;
  /** The pointer, in logical units, refreshed every frame. */
  pointerX = -1;
  pointerY = -1;

  // ---- The two read-only overlays ----
  showCombos = false;
  showDamage = false;

  // ---- Presentation ----
  /** Particle bursts raised by the simulation and still playing. */
  bursts: Burst[] = [];
  /** Bursts the step raised, drained by the frame that raised them. */
  fxQueue: FxEvent[] = [];
  /** Cues the step raised, each at most once, drained by the same frame. */
  cueQueue: CueName[] = [];
  /**
   * The produced files, loaded once by the game instance before the first frame and
   * seeded here when the world opens. A state stood up outside the engine — the build's
   * own tests do exactly that — carries the empty set, and the renderer falls back to
   * its own geometry.
   */
  assets: Assets = noAssets();
}

/**
 * The open world's state, as the state it is.
 *
 * The game mode names `FoundryState` as its `gameStateClass`, so this holds of every
 * world this game opens, and the check turns a wrong wiring into a named error rather
 * than a silent cast.
 */
export function foundryState(world: World): FoundryState {
  const state = world.state;
  if (!(state instanceof FoundryState)) {
    throw new Error("Arc Foundry: the open world does not hold a FoundryState");
  }
  return state;
}
