// Fathom — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it, and `initialize` returns it beside the state it
// built, as the pair `[state, debug]`: the engine holds the second element and
// returns it from `engine.debug`, which is the one way a caller reaches it.
// Nothing is installed on the page, nothing here holds state, and the surface is
// inert during normal play — nothing below runs until something calls it.
//
// Every operation is written in the shape of `update`, because nothing in this
// build holds a writable state. A POSE takes the current state and returns the
// next one, and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.beginPlay(s))`. A READING takes the current
// state and returns what it read, as `debug.snapshot(engine.state)`.
//
// That split is the point. These calls ARRANGE THE MAZE and never fabricate an
// outcome: they put the game into a situation, and the game's own sensing,
// pathfinding, release schedule and contact rules run from there when the engine
// advances a frame — through the very functions `update` calls. So a scenario
// driven from code behaves exactly like one played by hand.
//
// Everything about DRIVING A BROWSER GAME rather than about Fathom belongs to
// the engine and is deliberately absent: there is no clock operation (the engine
// owns the clock and runs exact frames), no key operation (the engine drives the
// registered actions, and a dispatched keyboard event moves the forager exactly
// as a player's key does), and no overlay operation (the engine draws the panel
// and owns the backtick key).

import {
  BRIGHT_HOLD,
  DEFAULT_SEED,
  DRIFTER_INTERVAL,
  FATHOM_DEBUG_VERSION,
  LINGER_TIME,
} from "./constants";
import { DIRS, centerX, centerY, tileIndex } from "./grid";
import {
  beginDive,
  beginLivePlay,
  housePredators,
  openingState,
  plantPlankton,
  restForager,
} from "./flow";
import {
  foragerCanEnter,
  layoutProblem,
  loadLayout,
  predatorCanEnter,
} from "./maze";
import { bodyTile } from "./entities";
import { chaseSpeedOf, holdInDen, wanderSpeed } from "./predators";
import { createDrifter } from "./simulate";
import { emptyGrid } from "./sensing";
import { snapshotOf, type FathomSnapshot } from "./snapshot";
import type { Dir, FathomState, MazeState, PredatorState, Tile } from "./state";
import type { DeepReadonly } from "ts-essentials";

/** The states `setPredatorState` poses. `"search"` is reached only by behavior. */
export type PosedPredatorMode = "den" | "wander" | "chase";

/**
 * The surface. Every pose takes the current state and returns the next; the one
 * reading, `snapshot`, takes the current state and returns what it read.
 */
export interface FathomDebugApi {
  version: number;
  reset(
    state: DeepReadonly<FathomState>,
    options?: { seed?: number },
  ): FathomState;
  snapshot(state: DeepReadonly<FathomState>): FathomSnapshot;
  startDive(state: DeepReadonly<FathomState>): FathomState;
  beginPlay(state: DeepReadonly<FathomState>): FathomState;
  setDepth(state: DeepReadonly<FathomState>, d: number): FathomState;
  setMaze(
    state: DeepReadonly<FathomState>,
    rows: readonly string[],
  ): FathomState;
  setForagerTile(
    state: DeepReadonly<FathomState>,
    tx: number,
    ty: number,
  ): FathomState;
  setForagerDir(state: DeepReadonly<FathomState>, dir: Dir): FathomState;
  setBrightness(state: DeepReadonly<FathomState>, g: number): FathomState;
  setPredatorTile(
    state: DeepReadonly<FathomState>,
    index: number,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorDir(
    state: DeepReadonly<FathomState>,
    index: number,
    dir: Dir,
  ): FathomState;
  setPredatorState(
    state: DeepReadonly<FathomState>,
    index: number,
    value: PosedPredatorMode,
  ): FathomState;
  spawnDrifter(
    state: DeepReadonly<FathomState>,
    tx: number,
    ty: number,
  ): FathomState;
  setCreatureAI(
    state: DeepReadonly<FathomState>,
    enabled: boolean,
  ): FathomState;
  setPlankton(
    state: DeepReadonly<FathomState>,
    tx: number,
    ty: number,
    present: boolean,
  ): FathomState;
  clearPlankton(state: DeepReadonly<FathomState>): FathomState;
  setSonarCooldown(
    state: DeepReadonly<FathomState>,
    seconds: number,
  ): FathomState;
  setInkCooldown(
    state: DeepReadonly<FathomState>,
    seconds: number,
  ): FathomState;
}

// ---- Domains -------------------------------------------------------------
//
// An argument outside the domain its operation states is invalid, and the call
// fails loudly rather than guessing what was meant.

function requireDir(op: string, dir: Dir): Dir {
  if (!DIRS.includes(dir)) {
    throw new RangeError(
      `Fathom: ${op} direction ${JSON.stringify(dir)} — expected one of ${DIRS.join(", ")}`,
    );
  }
  return dir;
}

function requireSeconds(op: string, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(
      `Fathom: ${op} seconds ${seconds} — expected a finite number of seconds, at least 0`,
    );
  }
  return seconds;
}

function requireCorridor(
  op: string,
  maze: MazeState,
  tx: number,
  ty: number,
): Tile {
  if (!foragerCanEnter(maze, tx, ty)) {
    throw new RangeError(
      `Fathom: ${op} tile (${tx}, ${ty}) — expected an open corridor tile`,
    );
  }
  return { tx, ty };
}

function requirePredator(
  op: string,
  predators: readonly PredatorState[],
  index: number,
): PredatorState {
  if (!Number.isInteger(index) || index < 0 || index >= predators.length) {
    throw new RangeError(
      `Fathom: ${op} index ${index} — the roster holds ${predators.length} predators, indexed from 0`,
    );
  }
  return predators[index];
}

/** The predators with the one at `index` replaced. */
function withPredator(
  predators: readonly PredatorState[],
  index: number,
  predator: PredatorState,
): readonly PredatorState[] {
  return predators.map((p, at) => (at === index ? predator : p));
}

/** A den tile to hold a predator on, or `null` on a layout with no chamber. */
function denTile(maze: MazeState, index: number): Tile | null {
  if (maze.denTiles.length === 0) return null;
  return maze.denTiles[index % maze.denTiles.length];
}

// ---- The surface ---------------------------------------------------------

/** Build the surface. It holds nothing: every operation is handed its state. */
export function createDebugApi(): FathomDebugApi {
  return {
    version: FATHOM_DEBUG_VERSION,

    /**
     * Every field of the observable state back at its title-screen value, with
     * the game's randomness reseeded.
     *
     * `muted` is deliberately untouched, because muting is a player preference
     * rather than a value a dive opens with, and the art is carried through
     * because it is the project's rather than the dive's.
     */
    reset(state, options) {
      return openingState(
        state.sheets,
        options?.seed ?? DEFAULT_SEED,
        state.muted,
      );
    },

    /** A pure read. It poses nothing, so it returns no state. */
    snapshot(state) {
      return snapshotOf(state, FATHOM_DEBUG_VERSION);
    },

    /**
     * The opening of a real dive, exactly as choosing `DIVE` from the title menu
     * poses it. The dive runs from there: the countdown ticks down against the
     * elapsed time and play begins through the game's own code.
     */
    startDive(state) {
      return beginDive(state);
    },

    /**
     * The dive countdown ended now, so `screen` becomes `"playing"` and the den's
     * release schedule starts from that moment. It applies on the `"countdown"`
     * screen alone.
     */
    beginPlay(state) {
      if (state.screen !== "countdown") return state;
      return beginLivePlay(state);
    },

    /**
     * The depth, from which everything depth scales recomputes: the roster is the
     * one `specs/predators.md` gives for `d`, back in the den and unreleased, and
     * the sonar range is the one `specs/progression.md` gives. It changes neither
     * the maze nor the screen.
     */
    setDepth(state, d) {
      if (!Number.isInteger(d) || d < 1) {
        throw new RangeError(
          `Fathom: setDepth depth ${d} — expected a whole number, at least 1`,
        );
      }
      // A posed board suspends every release time for as long as it stands, and
      // rebuilding the roster on that same board must not quietly re-arm the
      // schedule underneath it.
      const roster = housePredators(state.maze, d);
      const suspended =
        state.predators.length > 0 &&
        state.predators.every((p) => p.releaseIn === null);
      return {
        ...state,
        depth: d,
        predators: suspended
          ? roster.map((p, index) => holdInDen(p, denTile(state.maze, index)))
          : roster,
      };
    },

    /**
     * The maze replaced by a posed fixture, used exactly as given.
     *
     * The fixture is exempt from every rule in `specs/maze.md`, so only the three
     * ways a layout is not a layout are refused: the wrong size, a character
     * outside the alphabet, and den tiles without exactly one gate. Everything the
     * maze derives comes back off the new rows — the wrap tunnel, the gate and the
     * den — so a structure the fixture does not have simply takes no part.
     *
     * The board is left as a freshly laid-out maze starts: full plankton, the fog
     * back to unrevealed, the forager at rest on the first corridor tile in
     * reading order, and every predator returned to a den tile with its release
     * time SUSPENDED, so no release time arrives while the fixture stands. What
     * the game is doing — the score, the lives, the depth, the cooldowns and the
     * screen — is left exactly as it is.
     */
    setMaze(state, rows) {
      const problem = layoutProblem(rows);
      if (problem !== null) {
        throw new RangeError(`Fathom: setMaze rows — ${problem}`);
      }
      const maze = loadLayout(rows);
      const { plankton, planktonRemaining } = plantPlankton(maze);
      return {
        ...state,
        maze,
        plankton,
        planktonRemaining,
        revealed: emptyGrid(),
        lit: emptyGrid(),
        forager: restForager(maze.start),
        heldDirs: [],
        // A wavefront carries the corridor flood of the board it was cast on, a
        // drifter stands on a tile that may now be rock, and both belong to the
        // maze rather than to the dive, so the fixture opens without them.
        pulses: [],
        inkClouds: [],
        drifters: [],
        drifterIn: DRIFTER_INTERVAL,
        predators: state.predators.map((p, index) =>
          holdInDen(p, denTile(maze, index)),
        ),
      };
    },

    /**
     * The forager at rest on the center of an open corridor tile, as though no
     * movement key were held. Its facing is untouched, and injected input moves it
     * from there through the game's ordinary movement code.
     */
    setForagerTile(state, tx, ty) {
      const tile = requireCorridor("setForagerTile", state.maze, tx, ty);
      return {
        ...state,
        forager: {
          ...state.forager,
          x: centerX(tile.tx),
          y: centerY(tile.ty),
          heading: null,
          desired: null,
        },
      };
    },

    /** The forager's facing. It moves it nowhere and leaves it at rest. */
    setForagerDir(state, dir) {
      return {
        ...state,
        forager: {
          ...state.forager,
          facing: requireDir("setForagerDir", dir),
          heading: null,
        },
      };
    },

    /**
     * The brightness `G`, from which the light radius `V` and the Lanternjaw's and
     * Flarefish's detection ranges recompute.
     *
     * It arms the `BRIGHT_HOLD` brightness hold in full, exactly as eating a
     * plankton does, so the value it poses is steady for that full second and only
     * then decays on the ordinary curve. Posing neither a part-spent hold nor a
     * forager with no hold at all is what makes a measurement taken inside that
     * window mean the same thing every time.
     */
    setBrightness(state, g) {
      if (!Number.isFinite(g) || g < 0 || g > 1) {
        throw new RangeError(
          `Fathom: setBrightness brightness ${g} — expected a number in [0, 1]`,
        );
      }
      return { ...state, brightness: g, brightHold: BRIGHT_HOLD };
    },

    /**
     * One predator moved to the center of a tile it may stand on: an open corridor
     * tile, a den tile, or the den gate. Its facing, its state and its `released`
     * flag are untouched.
     */
    setPredatorTile(state, index, tx, ty) {
      const predator = requirePredator(
        "setPredatorTile",
        state.predators,
        index,
      );
      if (!predatorCanEnter(state.maze, tx, ty)) {
        throw new RangeError(
          `Fathom: setPredatorTile tile (${tx}, ${ty}) — expected an open corridor tile, a den tile or the den gate`,
        );
      }
      return {
        ...state,
        predators: withPredator(state.predators, index, {
          ...predator,
          x: centerX(tx),
          y: centerY(ty),
          heading: null,
        }),
      };
    },

    /** One predator's facing. */
    setPredatorDir(state, index, dir) {
      const predator = requirePredator(
        "setPredatorDir",
        state.predators,
        index,
      );
      return {
        ...state,
        predators: withPredator(state.predators, index, {
          ...predator,
          facing: requireDir("setPredatorDir", dir),
        }),
      };
    },

    /**
     * One predator's state. After the pose its own mind runs whenever the
     * simulation advances: it senses, acquires, chases and searches through the
     * real code.
     *
     * `"den"` returns it to a den tile, clears `released` and SUSPENDS its release
     * time, so it stays in the chamber however long the scenario runs; on a board
     * with no chamber it is held out of play, undrawn, unmoving and unable to make
     * contact. `"wander"` and `"chase"` set it loose on the tile it stands on with
     * its slot behind it, the first with no fix and the second fixed on the
     * forager's current tile.
     */
    setPredatorState(state, index, value) {
      const predator = requirePredator(
        "setPredatorState",
        state.predators,
        index,
      );
      if (value !== "den" && value !== "wander" && value !== "chase") {
        throw new RangeError(
          `Fathom: setPredatorState value ${JSON.stringify(value)} — expected "den", "wander" or "chase"`,
        );
      }
      return {
        ...state,
        predators: withPredator(
          state.predators,
          index,
          posePredator(state, predator, index, value),
        ),
      };
    },

    /**
     * One bonus drifter at the center of an open corridor tile. It then wanders
     * through the ordinary drifter code and is worth the ordinary bonus when
     * eaten, whatever the cadence is doing and whatever the ceiling would allow.
     */
    spawnDrifter(state, tx, ty) {
      const tile = requireCorridor("spawnDrifter", state.maze, tx, ty);
      return {
        ...state,
        drifters: [...state.drifters, createDrifter(tile.tx, tile.ty)],
      };
    },

    /**
     * The creatures' own minds, where a creature is every predator and every bonus
     * drifter. With them off each one holds exactly where it stands and everything
     * else continues.
     */
    setCreatureAI(state, enabled) {
      return { ...state, creatureAI: enabled };
    },

    /**
     * A plankton put on an open corridor tile or taken off it, with
     * `planktonRemaining` adjusted to match. Removing one this way is not eating
     * it, so it scores nothing and clears no maze.
     */
    setPlankton(state, tx, ty, present) {
      const tile = requireCorridor("setPlankton", state.maze, tx, ty);
      const index = tileIndex(tile.tx, tile.ty);
      if (state.plankton[index] === present) return state;
      const plankton = [...state.plankton];
      plankton[index] = present;
      return {
        ...state,
        plankton,
        planktonRemaining: state.planktonRemaining + (present ? 1 : -1),
      };
    },

    /**
     * Every plankton off the maze at once. As with `setPlankton` nothing here is
     * eaten, so an empty maze the forager has not just eaten from stays in live
     * play.
     */
    clearPlankton(state) {
      return { ...state, plankton: emptyGrid(), planktonRemaining: 0 };
    },

    /** The seconds left on the sonar pulse's cooldown, which runs down from there. */
    setSonarCooldown(state, seconds) {
      return {
        ...state,
        sonarCooldown: requireSeconds("setSonarCooldown", seconds),
      };
    },

    /** The seconds left on ink's cooldown, which runs down from there. */
    setInkCooldown(state, seconds) {
      return {
        ...state,
        inkCooldown: requireSeconds("setInkCooldown", seconds),
      };
    },
  };
}

/** One predator posed into `value`, with everything that state implies. */
function posePredator(
  state: DeepReadonly<FathomState>,
  predator: PredatorState,
  index: number,
  value: PosedPredatorMode,
): PredatorState {
  if (value === "den") {
    return holdInDen(predator, denTile(state.maze, index));
  }

  const loose: PredatorState = {
    ...predator,
    mode: "wander",
    released: true,
    releaseIn: 0,
    fix: null,
    linger: 0,
    // A pose is an arrangement rather than an acquisition, so it fires no alert
    // and leaves no sonar mark behind it.
    alertIn: 0,
    markIn: 0,
    searchIn: 0,
    searchPingIn: null,
    flarePhase: null,
    speed: wanderSpeed(predator.kind),
  };
  if (value === "wander") return loose;

  // A posed chase is fixed on the forager's current tile and holds that fix for
  // the same linger a real acquisition gives it, so it lapses through the game's
  // own rule rather than running forever.
  const forager = bodyTile(state.forager);
  return {
    ...loose,
    mode: "chase",
    fix: { tx: forager.tx, ty: forager.ty },
    linger: LINGER_TIME,
    speed: chaseSpeedOf(predator.kind),
  };
}
