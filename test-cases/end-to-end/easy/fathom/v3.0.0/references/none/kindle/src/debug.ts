// Fathom — the debugging and automation surface, `window.__fathom`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is
// inert during normal play: nothing below runs until something calls it.
//
// Almost every operation is expressed as a read or a pose of `FathomState`.
// That is the point of the split. These calls ARRANGE THE TRENCH and never
// fabricate an outcome: they put the game into a situation, and the game's own
// tick — the real sensing, the real pathfinding, the real release schedule and
// the real contact rules — is what runs from there. So a scenario driven from
// code behaves exactly like one played by hand.
//
// THE TWO EXCEPTIONS ARE THE CLOCK. `setAutoStep` and `advance` reach past the
// state into the runtime, because this build stands on no engine and nothing
// outside it owns its clock. Everything else about driving a browser game stays
// absent: there is no `keyDown`, `keyUp` or `press`, because the runtime's
// registered actions are driven by dispatching real key events at the page, and
// no overlay operation, because the runtime draws the panel and owns the
// backtick key.

import {
  BRIGHT_HOLD,
  DEFAULT_SEED,
  DRIFTER_SPEED,
  FATHOM_DEBUG_VERSION,
  GLOAMFIN_CHASE_SPEED,
  GRID_COLS,
  GRID_ROWS,
  LINGER_TIME,
} from "./constants";
import { Drifter, type Predator } from "./entities";
import {
  beginDive,
  beginLivePlay,
  buildRoster,
  denPredators,
  holdInDen,
  poseMaze,
  toTitle,
  type FathomState,
} from "./game";
import { tileKey } from "./sensing";
import { snapshot, type FathomSnapshot } from "./snapshot";
import { DIRS, type Dir, type PredatorState } from "./types";

/** The `window` property the surface is installed on. */
export const FATHOM_HANDLE = "__fathom";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this
 * file exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Whether the loop advances the simulation from the wall clock. */
  autoStep(): boolean;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `ticks` whole simulation ticks, then redraw. */
  advance(ticks: number): void;
}

/** The three states a predator may be posed into. `"search"` is not posed. */
const POSABLE_STATES: readonly PredatorState[] = ["den", "wander", "chase"];

export interface FathomDebugApi {
  version: number;
  setAutoStep(enabled: boolean): void;
  advance(ticks: number): void;
  reset(options?: { seed?: number }): void;
  snapshot(): FathomSnapshot;
  startDive(): void;
  beginPlay(): void;
  setDepth(d: number): void;
  setMaze(rows: readonly string[]): void;
  setForagerTile(tx: number, ty: number): void;
  setForagerDir(dir: Dir): void;
  setBrightness(g: number): void;
  setPredatorTile(index: number, tx: number, ty: number): void;
  setPredatorDir(index: number, dir: Dir): void;
  setPredatorState(index: number, value: PredatorState): void;
  spawnDrifter(tx: number, ty: number): void;
  setCreatureAI(enabled: boolean): void;
  setPlankton(tx: number, ty: number, present: boolean): void;
  clearPlankton(): void;
  setSonarCooldown(seconds: number): void;
  setInkCooldown(seconds: number): void;
}

/** Fail loudly rather than guessing what an out-of-domain argument meant. */
function invalid(message: string): never {
  throw new RangeError(`Fathom: ${message}`);
}

function requireWhole(name: string, value: number, least: number): number {
  if (!Number.isInteger(value) || value < least) {
    invalid(
      `${name} must be a whole number of at least ${least}, got ${value}`,
    );
  }
  return value;
}

function requireSeconds(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    invalid(`${name} must be a finite number of seconds, got ${value}`);
  }
  return value;
}

function requireDir(value: Dir): Dir {
  if (!DIRS.includes(value)) {
    invalid(`a direction must be one of ${DIRS.join(", ")}, got ${value}`);
  }
  return value;
}

function requireOnGrid(tx: number, ty: number): void {
  if (
    !Number.isInteger(tx) ||
    !Number.isInteger(ty) ||
    tx < 0 ||
    tx >= GRID_COLS ||
    ty < 0 ||
    ty >= GRID_ROWS
  ) {
    invalid(`the tile (${tx}, ${ty}) is off the grid`);
  }
}

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: FathomState,
  clock: DebugClock,
): FathomDebugApi {
  /** A tile the forager, a drifter or a plankton may stand on. */
  function requireCorridor(tx: number, ty: number): void {
    requireOnGrid(tx, ty);
    if (!state.maze.isCorridor(tx, ty)) {
      invalid(`the tile (${tx}, ${ty}) is not an open corridor tile`);
    }
  }

  /** A tile a predator may stand on: corridor, the den chamber, or the gate. */
  function requirePredatorTile(tx: number, ty: number): void {
    requireOnGrid(tx, ty);
    if (!state.maze.isDenOpen(tx, ty)) {
      invalid(`the tile (${tx}, ${ty}) is not open to a predator`);
    }
  }

  /** One predator, selected by its position in the snapshot's list. */
  function predatorAt(index: number): Predator {
    const p = state.predators[index];
    if (p === undefined) {
      invalid(
        `predator index ${index} is outside the roster of ${state.predators.length}`,
      );
    }
    return p;
  }

  return {
    version: FATHOM_DEBUG_VERSION,

    /**
     * Take the game off real time, and give it back.
     *
     * Drawing is unaffected either way: the loop keeps rendering, so the canvas
     * shows the state the most recent tick left.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `ticks` whole simulation ticks immediately and in order, each worth
     * exactly one `TICK_DT`.
     *
     * Every one is a real tick, the same one the frame loop runs, so the game's
     * own sensing, pathfinding and contact rules produce the result. Advancing
     * while the game is still stepping automatically ADDS to what the wall clock
     * is already doing, so a reproducible scenario calls `setAutoStep(false)`
     * first.
     */
    advance(ticks) {
      clock.advance(requireWhole("a tick count", ticks, 0));
    },

    /**
     * Return the game to its title-screen values and reseed its randomness.
     *
     * `muted` is deliberately untouched: muting is a player preference the
     * runtime owns, and a reset is not a reason to start making noise again.
     * Manual stepping is re-armed, so the game comes back off the wall clock.
     */
    reset(options) {
      const seed = options?.seed ?? DEFAULT_SEED;
      if (!Number.isFinite(seed)) invalid(`a seed must be finite, got ${seed}`);
      state.rng.reseed(seed);
      state.creatureAI = true;
      toTitle(state);
      state.simTime = 0;
      clock.setAutoStep(false);
    },

    /** A pure read. It changes nothing. */
    snapshot() {
      return snapshot(state, clock.autoStep());
    },

    /**
     * Pose the opening of a real dive, exactly as choosing `DIVE` from the title
     * menu does. The dive runs from there: the countdown ticks down against the
     * elapsed time and play begins through the game's own code.
     */
    startDive() {
      beginDive(state);
    },

    /**
     * End the dive countdown immediately instead of waiting it out, so the den's
     * release schedule starts from that moment.
     */
    beginPlay() {
      if (state.screen !== "countdown") return;
      beginLivePlay(state);
    },

    /**
     * Set the current depth. Everything depth scales recomputes from it, so the
     * roster is the one that depth holds and the sonar range is that depth's,
     * and a caller reads both back from the snapshot. The maze and the screen
     * are left as they are.
     */
    setDepth(d) {
      state.depth = requireWhole("a depth", d, 1);
      // Rebuilding is what makes the roster the depth's own. The hunters go back
      // to the den with the schedule re-armed, because a hunter of the previous
      // roster left loose in the corridors is not part of this depth's dive.
      buildRoster(state);
      denPredators(state);
    },

    /** Replace the maze layout with a posed fixture. */
    setMaze(rows) {
      if (!Array.isArray(rows)) {
        invalid("setMaze takes an array of row strings");
      }
      for (const row of rows) {
        if (typeof row !== "string") invalid("every posed row is a string");
      }
      poseMaze(state, rows);
    },

    /**
     * Move the forager to a tile's center and leave it at rest there, as though
     * no movement key were held. Its facing is untouched, and injected input
     * moves it from there through the game's ordinary movement code.
     */
    setForagerTile(tx, ty) {
      requireCorridor(tx, ty);
      state.forager.placeOn(tx, ty);
      state.desired = null;
    },

    /** Set the forager's facing. It moves nowhere and stays at rest. */
    setForagerDir(dir) {
      state.forager.facing = requireDir(dir);
      state.forager.dir = null;
      state.desired = null;
    },

    /**
     * Set the brightness `G`. Everything derived from it — the light radius `V`
     * and the two light hunters' detection ranges — recomputes from it.
     *
     * It arms the `BRIGHT_HOLD` window in full, exactly as eating a plankton
     * does, so the value it poses is steady for that whole second and only then
     * decays. The hold is armed in full every time, so this poses neither a
     * part-spent hold nor a forager with no hold at all.
     */
    setBrightness(g) {
      if (!Number.isFinite(g) || g < 0 || g > 1) {
        invalid(`a brightness must lie in [0, 1], got ${g}`);
      }
      state.forager.brightness = g;
      state.forager.hold = BRIGHT_HOLD;
    },

    /**
     * Move one predator to a tile's center and leave it there. Its facing, its
     * state and its `released` flag are untouched.
     */
    setPredatorTile(index, tx, ty) {
      const p = predatorAt(index);
      requirePredatorTile(tx, ty);
      p.placeOn(tx, ty);
    },

    /** Set one predator's facing. */
    setPredatorDir(index, dir) {
      const p = predatorAt(index);
      p.facing = requireDir(dir);
      p.dir = null;
    },

    /**
     * Pose one predator's state. After the pose its own mind runs whenever the
     * simulation advances: it senses, acquires, chases and searches through the
     * real code.
     */
    setPredatorState(index, value) {
      const p = predatorAt(index);
      if (!POSABLE_STATES.includes(value)) {
        invalid(
          `a posed predator state is one of ${POSABLE_STATES.join(", ")}, got ${value}`,
        );
      }
      if (value === "den") {
        // Its release time is suspended, so it stays in the chamber however long
        // the scenario runs, until a later call poses it out.
        holdInDen(state, p);
        return;
      }
      p.state = value;
      p.released = true;
      p.heldInDen = false;
      p.alertT = 0;
      p.markT = 0;
      p.searchTimer = 0;
      p.searchPinged = false;
      p.flarePhase = "none";
      p.flarePhaseT = 0;
      if (value === "wander") {
        p.fix = null;
        p.linger = 0;
        return;
      }
      // A chase opens on a fix on the forager's tile, at the speed a fresh
      // acquisition opens at and with the ordinary linger ahead of it.
      p.fix = state.forager.tile;
      p.linger = LINGER_TIME;
      p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
    },

    /**
     * Add one bonus drifter, which then wanders through the ordinary drifter
     * code and is worth the ordinary bonus when eaten. It is added whatever the
     * cadence is doing and whatever the ceiling would otherwise allow.
     */
    spawnDrifter(tx, ty) {
      requireCorridor(tx, ty);
      state.drifters.push(new Drifter(tx, ty, DRIFTER_SPEED));
    },

    /**
     * Turn the creatures' own minds on or off. With them off each creature holds
     * exactly where it stands; everything else about the dive continues.
     */
    setCreatureAI(enabled) {
      state.creatureAI = Boolean(enabled);
    },

    /**
     * Put a plankton on a tile or take one off, adjusting the count to match.
     * Removing one this way is not eating it, so it scores nothing and clears no
     * maze.
     */
    setPlankton(tx, ty, present) {
      requireCorridor(tx, ty);
      const key = tileKey(tx, ty);
      const wanted = Boolean(present);
      if (state.plankton[key] === wanted) return;
      state.plankton[key] = wanted;
      state.planktonRemaining += wanted ? 1 : -1;
    },

    /**
     * Take every plankton off the maze at once. As with `setPlankton`, nothing
     * here is eaten, so an empty maze the forager has not just eaten from stays
     * in live play.
     */
    clearPlankton() {
      state.plankton.fill(false);
      state.planktonRemaining = 0;
    },

    /** Set the seconds left on the sonar pulse's cooldown. */
    setSonarCooldown(seconds) {
      state.sonarCooldown = requireSeconds("a sonar cooldown", seconds);
    },

    /** Set the seconds left on ink's cooldown. */
    setInkCooldown(seconds) {
      state.inkCooldown = requireSeconds("an ink cooldown", seconds);
    },
  };
}

/**
 * Install the surface on `window.__fathom` and return the function that removes
 * it again, while the installed object is still the one this call published.
 */
export function installDebugApi(
  state: FathomState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[FATHOM_HANDLE] = api;
  return () => {
    if (target[FATHOM_HANDLE] === api) delete target[FATHOM_HANDLE];
  };
}
